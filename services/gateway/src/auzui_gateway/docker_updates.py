"""Registry digest checks (WUD/Diun-principle, plan.md D7).

For each image reference the caller already knows the *local* digest (taken
from a container's `RepoDigests` by `docker_hosts.py`); this module only has
to fetch the *remote* digest that the registry currently serves for the same
tag and compare the two. It never pulls or downloads a manifest body — a
`HEAD /v2/<name>/manifests/<tag>` request is enough, because registries
return the manifest digest as the `Docker-Content-Digest` response header.
That keeps rate limits (notably Docker Hub's anonymous pull quota, which
counts manifest HEAD/GET the same as a pull) as cheap as possible, and the
result is cached hard on top (`docker_update_check_ttl`, default 1h).

Auth follows the standard Docker Registry v2 Bearer flow: an anonymous
request gets a 401 with a `WWW-Authenticate: Bearer realm=...,service=...,
scope=...` challenge, which is exchanged for a short-lived token at `realm`
(HTTP Basic with the configured username/token when a matching entry exists
in `settings.docker_registry_list`, anonymous otherwise — this is exactly
how Docker Hub's `auth.docker.io` accepts anonymous pull-scope tokens).

Every failure mode (network error, 404, 401 without usable credentials, a
challenge the client cannot parse) degrades to status "unknown" rather than
raising — a flaky registry must never break the rest of the update check."""

import logging
import re
from dataclasses import dataclass
from typing import Any

import httpx

from .cache import TTLCache
from .config import Settings

logger = logging.getLogger(__name__)

# Accept headers covering both multi-arch manifest lists (Docker + OCI) and
# the single-platform manifest types they point to, so the registry can
# answer with whichever form the tag actually resolves to.
MANIFEST_ACCEPT = ", ".join(
    [
        "application/vnd.docker.distribution.manifest.list.v2+json",
        "application/vnd.oci.image.index.v1+json",
        "application/vnd.docker.distribution.manifest.v2+json",
        "application/vnd.oci.image.manifest.v1+json",
        "application/vnd.docker.distribution.manifest.v1+json",
    ]
)

DEFAULT_REGISTRY = "registry-1.docker.io"
DEFAULT_TAG = "latest"


@dataclass(frozen=True)
class ImageRef:
    """A parsed `registry/repo:tag` (or `...@sha256:...`) reference."""

    registry: str
    repo: str
    tag: str
    digest: str = ""  # set when the reference pins a digest (`@sha256:...`)


def parse_image_ref(ref: str) -> ImageRef:
    """Splits an image reference into registry host, repository path and tag,
    applying the same defaulting Docker itself uses:

    - no registry segment (no dot/colon before the first `/`, or no `/` at
      all) → Docker Hub (`registry-1.docker.io`);
    - a single-segment repo on Docker Hub (`nginx`) → `library/nginx`;
    - no tag → `latest`.

    A trailing `@sha256:...` digest is captured separately and does not
    affect tag defaulting (Docker allows `name:tag@sha256:...` and bare
    `name@sha256:...`)."""
    digest = ""
    if "@" in ref:
        ref, digest = ref.split("@", 1)

    if "/" in ref:
        first, remainder = ref.split("/", 1)
        # A registry segment must look like a host: contains "." or ":", or
        # is literally "localhost". Otherwise the first segment is part of
        # the Docker Hub repo path (e.g. "library/nginx").
        if "." in first or ":" in first or first == "localhost":
            registry = first
            repo_and_tag = remainder
        else:
            registry = DEFAULT_REGISTRY
            repo_and_tag = ref
    else:
        registry = DEFAULT_REGISTRY
        repo_and_tag = ref

    # Split off the tag on the LAST colon that comes after the last slash,
    # so a registry port (already consumed above) never gets mistaken for one.
    if "/" in repo_and_tag:
        path_prefix, last_segment = repo_and_tag.rsplit("/", 1)
        sep = "/"
    else:
        path_prefix, last_segment = "", repo_and_tag
        sep = ""
    if ":" in last_segment:
        last_segment, tag = last_segment.rsplit(":", 1)
    else:
        tag = DEFAULT_TAG
    repo = f"{path_prefix}{sep}{last_segment}" if path_prefix else last_segment

    if registry == DEFAULT_REGISTRY and "/" not in repo:
        repo = f"library/{repo}"

    return ImageRef(registry=registry, repo=repo, tag=tag, digest=digest)


_CHALLENGE_RE = re.compile(r'(\w+)="([^"]*)"')


def _parse_bearer_challenge(header: str) -> dict[str, str] | None:
    """Parses a `WWW-Authenticate: Bearer realm="...",service="...",
    scope="..."` header into its key/value parts, or None if it isn't a
    Bearer challenge this client understands."""
    if not header.lower().startswith("bearer "):
        return None
    params = dict(_CHALLENGE_RE.findall(header))
    if "realm" not in params:
        return None
    return params


class UpdateChecker:
    """Checks configured images against their registries for a newer digest,
    per CONTRACT 2.4. Stateless aside from the TTL cache; safe to share
    across requests."""

    def __init__(self, settings: Settings) -> None:
        self._s = settings
        self._cache: TTLCache[str] = TTLCache(settings.docker_update_check_ttl)
        self._creds = {r.registry: r for r in settings.docker_registry_list}

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=self._s.docker_timeout)

    async def _fetch_token(
        self, client: httpx.AsyncClient, challenge: dict[str, str], registry: str
    ) -> str | None:
        params = {k: v for k, v in challenge.items() if k in ("service", "scope")}
        auth = None
        creds = self._creds.get(registry)
        if creds and creds.username:
            auth = (creds.username, creds.token)
        try:
            res = await client.get(challenge["realm"], params=params, auth=auth)
        except httpx.HTTPError as e:
            logger.info("docker registry %s: token request failed: %r", registry, e)
            return None
        if res.status_code != 200:
            return None
        body = res.json()
        return body.get("token") or body.get("access_token")

    async def _remote_digest(self, client: httpx.AsyncClient, image: ImageRef) -> str | None:
        url = f"https://{image.registry}/v2/{image.repo}/manifests/{image.tag}"
        headers = {"Accept": MANIFEST_ACCEPT}
        try:
            res = await client.head(url, headers=headers)
            if res.status_code == 401:
                challenge = _parse_bearer_challenge(res.headers.get("WWW-Authenticate", ""))
                if challenge is None:
                    return None
                token = await self._fetch_token(client, challenge, image.registry)
                if token is None:
                    return None
                headers["Authorization"] = f"Bearer {token}"
                res = await client.head(url, headers=headers)
        except httpx.HTTPError as e:
            logger.info("docker registry %s/%s: request failed: %r", image.registry, image.repo, e)
            return None
        if res.status_code != 200:
            return None
        return res.headers.get("Docker-Content-Digest") or None

    async def _check_one(
        self, client: httpx.AsyncClient, ref: str, local_digest: str
    ) -> dict[str, Any]:
        image = parse_image_ref(ref)
        if not local_digest:
            return {"tag": image.tag, "local_digest": "", "remote_digest": "", "status": "unknown"}

        cache_key = f"{image.registry}/{image.repo}:{image.tag}"
        remote_digest = self._cache.get(cache_key)
        if remote_digest is None:
            fetched = await self._remote_digest(client, image)
            remote_digest = fetched or ""
            self._cache.set(cache_key, remote_digest)

        if not remote_digest:
            status = "unknown"
        elif remote_digest == local_digest:
            status = "current"
        else:
            status = "outdated"
        return {
            "tag": image.tag,
            "local_digest": local_digest,
            "remote_digest": remote_digest,
            "status": status,
        }

    async def check(self, images: list[tuple[str, str]]) -> dict[str, dict[str, Any]]:
        """Checks a batch of `(image_ref, local_digest)` pairs and returns
        `{image_ref: {tag, local_digest, remote_digest, status}}`. A missing
        `local_digest` (image was never pulled from a registry, e.g. built
        locally) short-circuits to `status="unknown"` without a network call.
        Every per-image failure degrades to `unknown`; this method itself
        never raises."""
        async with self._client() as client:
            results: dict[str, dict[str, Any]] = {}
            for ref, local_digest in images:
                try:
                    results[ref] = await self._check_one(client, ref, local_digest)
                except Exception as e:  # noqa: BLE001 - a bad image ref must not abort the batch
                    logger.warning("docker update check for %r failed: %r", ref, e)
                    results[ref] = {
                        "tag": "",
                        "local_digest": local_digest,
                        "remote_digest": "",
                        "status": "unknown",
                    }
            return results
