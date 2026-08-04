from fastapi import Header, HTTPException


def bearer_token(authorization: str | None = Header(default=None)) -> str:
    """The caller's Zabbix session token — required on every data endpoint."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token (Zabbix session)")
    return authorization[7:].strip()
