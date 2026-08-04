import httpx
import pytest
import respx

from auzui_gateway.config import Settings
from auzui_gateway.docker_updates import (
    DEFAULT_REGISTRY,
    UpdateChecker,
    bare_digest,
    parse_image_ref,
)

# --- parse_image_ref -------------------------------------------------------


@pytest.mark.parametrize(
    ("ref", "registry", "repo", "tag"),
    [
        ("docker.io/library/nginx:1.25", "docker.io", "library/nginx", "1.25"),
        ("nginx", DEFAULT_REGISTRY, "library/nginx", "latest"),
        ("nginx:1.25", DEFAULT_REGISTRY, "library/nginx", "1.25"),
        ("ghcr.io/org/app:tag", "ghcr.io", "org/app", "tag"),
        ("registry:5000/app:tag", "registry:5000", "app", "tag"),
        ("library/nginx", DEFAULT_REGISTRY, "library/nginx", "latest"),
        ("org/app", DEFAULT_REGISTRY, "org/app", "latest"),
        ("localhost/app:tag", "localhost", "app", "tag"),
        ("localhost:5000/app", "localhost:5000", "app", "latest"),
    ],
)
def test_parse_image_ref_matrix(ref, registry, repo, tag):
    parsed = parse_image_ref(ref)
    assert parsed.registry == registry
    assert parsed.repo == repo
    assert parsed.tag == tag


def test_parse_image_ref_with_digest():
    parsed = parse_image_ref(
        "ghcr.io/org/app@sha256:" + "a" * 64,
    )
    assert parsed.registry == "ghcr.io"
    assert parsed.repo == "org/app"
    assert parsed.tag == "latest"
    assert parsed.digest == "sha256:" + "a" * 64


def test_parse_image_ref_tag_and_digest():
    parsed = parse_image_ref("nginx:1.25@sha256:" + "b" * 64)
    assert parsed.registry == DEFAULT_REGISTRY
    assert parsed.repo == "library/nginx"
    assert parsed.tag == "1.25"
    assert parsed.digest == "sha256:" + "b" * 64


# --- UpdateChecker.check -----------------------------------------------------


def make_settings(**overrides) -> Settings:
    base = {"docker_update_check_ttl": 3600.0}
    base.update(overrides)
    return Settings(_env_file=None, **base)


LOCAL_DIGEST = "sha256:" + "1" * 64
REMOTE_DIGEST_SAME = LOCAL_DIGEST
REMOTE_DIGEST_NEW = "sha256:" + "2" * 64


@respx.mock
async def test_check_current_when_digests_match():
    settings = make_settings()
    checker = UpdateChecker(settings)

    route = respx.head("https://registry-1.docker.io/v2/library/nginx/manifests/1.25").mock(
        return_value=httpx.Response(200, headers={"Docker-Content-Digest": REMOTE_DIGEST_SAME})
    )

    result = await checker.check([("nginx:1.25", LOCAL_DIGEST)])
    assert result["nginx:1.25"] == {
        "tag": "1.25",
        "local_digest": LOCAL_DIGEST,
        "remote_digest": REMOTE_DIGEST_SAME,
        "status": "current",
    }
    assert route.call_count == 1


@respx.mock
async def test_check_outdated_when_digests_differ():
    settings = make_settings()
    checker = UpdateChecker(settings)

    respx.head("https://registry-1.docker.io/v2/library/nginx/manifests/1.25").mock(
        return_value=httpx.Response(200, headers={"Docker-Content-Digest": REMOTE_DIGEST_NEW})
    )

    result = await checker.check([("nginx:1.25", LOCAL_DIGEST)])
    assert result["nginx:1.25"]["status"] == "outdated"
    assert result["nginx:1.25"]["remote_digest"] == REMOTE_DIGEST_NEW


@respx.mock
async def test_check_anonymous_docker_hub_token_flow():
    settings = make_settings()
    checker = UpdateChecker(settings)

    challenge = (
        'Bearer realm="https://auth.docker.io/token",'
        'service="registry.docker.io",scope="repository:library/nginx:pull"'
    )
    manifest_route = respx.head("https://registry-1.docker.io/v2/library/nginx/manifests/latest")
    manifest_route.side_effect = [
        httpx.Response(401, headers={"WWW-Authenticate": challenge}),
        httpx.Response(200, headers={"Docker-Content-Digest": REMOTE_DIGEST_NEW}),
    ]
    token_route = respx.get("https://auth.docker.io/token").mock(
        return_value=httpx.Response(200, json={"token": "anon-token"})
    )

    result = await checker.check([("nginx", LOCAL_DIGEST)])
    assert result["nginx"]["status"] == "outdated"
    assert result["nginx"]["remote_digest"] == REMOTE_DIGEST_NEW
    assert token_route.call_count == 1
    # First HEAD gets the 401 challenge, second HEAD carries the Bearer token.
    assert manifest_route.call_count == 2
    second_request = manifest_route.calls[1].request
    assert second_request.headers["Authorization"] == "Bearer anon-token"
    # Anonymous request: no Authorization sent to the token endpoint.
    assert "Authorization" not in token_route.calls[0].request.headers


@respx.mock
async def test_check_registry_with_credentials():
    settings = make_settings(
        docker_registries='[{"registry":"ghcr.io","username":"bot","token":"secret"}]'
    )
    checker = UpdateChecker(settings)

    challenge = (
        'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:org/app:pull"'
    )
    manifest_route = respx.head("https://ghcr.io/v2/org/app/manifests/tag")
    manifest_route.side_effect = [
        httpx.Response(401, headers={"WWW-Authenticate": challenge}),
        httpx.Response(200, headers={"Docker-Content-Digest": REMOTE_DIGEST_SAME}),
    ]
    token_route = respx.get("https://ghcr.io/token").mock(
        return_value=httpx.Response(200, json={"token": "creds-token"})
    )

    result = await checker.check([("ghcr.io/org/app:tag", REMOTE_DIGEST_SAME)])
    assert result["ghcr.io/org/app:tag"]["status"] == "current"
    request = token_route.calls[0].request
    assert request.headers["Authorization"].startswith("Basic ")


@respx.mock
async def test_check_caches_within_ttl():
    settings = make_settings()
    checker = UpdateChecker(settings)

    route = respx.head("https://registry-1.docker.io/v2/library/nginx/manifests/1.25").mock(
        return_value=httpx.Response(200, headers={"Docker-Content-Digest": REMOTE_DIGEST_SAME})
    )

    await checker.check([("nginx:1.25", LOCAL_DIGEST)])
    await checker.check([("nginx:1.25", LOCAL_DIGEST)])
    assert route.call_count == 1


# --- unknown cases -----------------------------------------------------------


@respx.mock
async def test_check_unknown_without_local_digest():
    settings = make_settings()
    checker = UpdateChecker(settings)

    result = await checker.check([("nginx:1.25", "")])
    assert result["nginx:1.25"] == {
        "tag": "1.25",
        "local_digest": "",
        "remote_digest": "",
        "status": "unknown",
    }


@respx.mock
async def test_check_unknown_on_404():
    settings = make_settings()
    checker = UpdateChecker(settings)

    respx.head("https://registry-1.docker.io/v2/library/nginx/manifests/1.25").mock(
        return_value=httpx.Response(404)
    )

    result = await checker.check([("nginx:1.25", LOCAL_DIGEST)])
    assert result["nginx:1.25"]["status"] == "unknown"
    assert result["nginx:1.25"]["remote_digest"] == ""


@respx.mock
async def test_check_unknown_on_network_error():
    settings = make_settings()
    checker = UpdateChecker(settings)

    respx.head("https://registry-1.docker.io/v2/library/nginx/manifests/1.25").mock(
        side_effect=httpx.ConnectError("boom")
    )

    result = await checker.check([("nginx:1.25", LOCAL_DIGEST)])
    assert result["nginx:1.25"]["status"] == "unknown"


@respx.mock
async def test_check_unknown_on_401_without_credentials():
    settings = make_settings()
    checker = UpdateChecker(settings)

    challenge = (
        'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:org/app:pull"'
    )
    respx.head("https://ghcr.io/v2/org/app/manifests/tag").mock(
        return_value=httpx.Response(401, headers={"WWW-Authenticate": challenge})
    )
    respx.get("https://ghcr.io/token").mock(return_value=httpx.Response(401))

    result = await checker.check([("ghcr.io/org/app:tag", LOCAL_DIGEST)])
    assert result["ghcr.io/org/app:tag"]["status"] == "unknown"


# --- RepoDigest normalization ----------------------------------------------

REPO_DIGEST = f"ghcr.io/org/app@{LOCAL_DIGEST}"


def test_bare_digest_strips_the_repo_prefix():
    assert bare_digest(REPO_DIGEST) == LOCAL_DIGEST
    assert bare_digest(LOCAL_DIGEST) == LOCAL_DIGEST  # already bare
    assert bare_digest("") == ""


@respx.mock
async def test_check_current_when_local_is_a_full_repodigest():
    """Regression: docker_routes._local_digest hands over Docker's RepoDigest
    form (`repo@sha256:...`), the registry header carries the bare digest.
    Comparing them verbatim marked every container outdated — on the instance
    this was found on, all 19 of them, every hash identical bar the prefix."""
    checker = UpdateChecker(make_settings())

    respx.head("https://ghcr.io/v2/org/app/manifests/1.25").mock(
        return_value=httpx.Response(200, headers={"Docker-Content-Digest": REMOTE_DIGEST_SAME})
    )

    result = await checker.check([("ghcr.io/org/app:1.25", REPO_DIGEST)])
    assert result["ghcr.io/org/app:1.25"]["status"] == "current"
    # Reported back in the same shape as remote_digest, so the two are comparable.
    assert result["ghcr.io/org/app:1.25"]["local_digest"] == LOCAL_DIGEST


@respx.mock
async def test_check_still_detects_a_real_update_through_a_repodigest():
    checker = UpdateChecker(make_settings())

    respx.head("https://ghcr.io/v2/org/app/manifests/1.25").mock(
        return_value=httpx.Response(200, headers={"Docker-Content-Digest": REMOTE_DIGEST_NEW})
    )

    result = await checker.check([("ghcr.io/org/app:1.25", REPO_DIGEST)])
    assert result["ghcr.io/org/app:1.25"]["status"] == "outdated"
