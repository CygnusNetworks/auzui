import httpx
import pytest

from auzui_gateway.app import create_app
from auzui_gateway.config import Settings

ZABBIX_URL = "https://zbx.test/api_jsonrpc.php"
INFLUX_URL = "https://influx.test"
GRAYLOG_URL = "https://graylog.test"


def make_settings(**overrides) -> Settings:
    base = {
        "zabbix_api_url": ZABBIX_URL,
        "influx_url": INFLUX_URL,
        "influx_token": "influx-secret",
        "influx_org": "example.com",
        "influx_bucket": "zabbix",
        "graylog_url": GRAYLOG_URL,
        "graylog_token": "graylog-secret",
        "serve_frontend": False,
    }
    base.update(overrides)
    return Settings(_env_file=None, **base)


@pytest.fixture
def settings() -> Settings:
    return make_settings()


@pytest.fixture
async def client(settings: Settings):
    app = create_app(settings)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://gw.test") as c:
        yield c


@pytest.fixture
async def client_disabled():
    app = create_app(
        make_settings(
            influx_url="", influx_token="", influx_org="", graylog_url="", graylog_token=""
        )
    )
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://gw.test") as c:
        yield c


AUTH = {"Authorization": "Bearer zbx-session-token"}


def zabbix_result(result):
    return {"jsonrpc": "2.0", "id": 1, "result": result}
