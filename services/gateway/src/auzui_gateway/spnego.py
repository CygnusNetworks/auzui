"""Kerberos/SPNEGO ("Negotiate") authentication.

Pattern follows tiqora's implementation: ``gssapi`` is a sync C-extension
library, so calls run in an executor; the import is indirected through
:func:`_import_gssapi` so tests can substitute a fake module instead of
requiring a real KDC/keytab.
"""

import asyncio
import os
from typing import Any

from .config import Settings


class SpnegoUnavailable(Exception):
    """gssapi missing, or negotiation cannot complete (multi-leg)."""


class SpnegoAuthFailed(Exception):
    """The client's Negotiate token failed validation against the keytab
    (malformed/expired ticket, principal mismatch, clock skew) → 401."""


def _import_gssapi() -> Any:
    try:
        import gssapi
    except ImportError as exc:
        raise SpnegoUnavailable(
            "gssapi is not installed; build the image with the 'kerberos' extra"
        ) from exc
    return gssapi


class SpnegoService:
    """Accepts a client's Negotiate token and returns the Kerberos principal."""

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def _accept_sync(self, token: bytes) -> str:
        gssapi = _import_gssapi()
        if self._settings.krb5_ktname:
            os.environ["KRB5_KTNAME"] = self._settings.krb5_ktname
        try:
            server_creds = gssapi.Credentials(usage="accept")
            ctx = gssapi.SecurityContext(creds=server_creds, usage="accept")
            ctx.step(token)
            # gssapi defers some errors (e.g. unwritable replay cache) until
            # the next attribute access — keep these inside the try block.
            complete = ctx.complete
            initiator = str(ctx.initiator_name)
        except Exception as exc:  # noqa: BLE001 — gssapi.exceptions.GSSError (dynamic import)
            raise SpnegoAuthFailed(f"SPNEGO negotiation failed: {exc}") from exc
        if not complete:
            raise SpnegoUnavailable("multi-leg SPNEGO negotiation is not supported")
        return initiator

    async def accept(self, token: bytes) -> str:
        """Return the full Kerberos principal (``user@REALM``) for *token*."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(None, self._accept_sync, token)


def principal_to_login(principal: str) -> str:
    """``user@REALM`` / ``user/instance@REALM`` → ``user`` (Zabbix login)."""
    return principal.split("@", 1)[0].split("/", 1)[0]
