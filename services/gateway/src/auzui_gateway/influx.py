"""InfluxDB 2 (effluence export) query path.

effluence schema: measurements `history` (float) and `history_uint` (uint),
tag `itemid` (string), field value, `_time` timestamp. Server-side
aggregateWindow does the downsampling — the whole point of this path
(PLAN.md: <120 ms for any range vs. 50 s history.get on a large instance).
"""

import csv
import io
import logging

import httpx
from fastapi import HTTPException

from .config import Settings

logger = logging.getLogger(__name__)

VALID_FNS = {"last", "mean", "min", "max"}


def build_flux(
    bucket: str, itemids: list[str], start: int, end: int, every_seconds: int, fn: str
) -> str:
    id_filter = " or ".join(f'r.itemid == "{i}"' for i in itemids)
    return (
        f'from(bucket: "{bucket}")\n'
        f"  |> range(start: {start}, stop: {end})\n"
        '  |> filter(fn: (r) => r._measurement == "history"'
        ' or r._measurement == "history_uint")\n'
        f"  |> filter(fn: (r) => {id_filter})\n"
        '  |> group(columns: ["itemid"])\n'
        f"  |> aggregateWindow(every: {every_seconds}s, fn: {fn}, createEmpty: false)"
    )


def choose_every(start: int, end: int, points: int, min_window: int = 1) -> int:
    """Window size (seconds) so the range yields roughly `points` samples.

    Floored at ``min_window``: a window finer than the items' native poll
    interval reveals no extra data (there is only one raw sample per interval),
    but it DOES scatter each item onto its own phase of tiny window boundaries.
    Items on a host are sampled a few seconds apart, so at e.g. ``every=3s``
    their downsampled timestamps land in *adjacent* windows and never coincide.
    The frontend then merges the series onto a union x-axis where every value
    sits isolated between nulls, and uPlot (point markers off) draws no line at
    all -- a blank chart for short ranges (15m/1h) while 6h+ happened to use a
    window coarse enough to re-align. Flooring ``every`` snaps all items to a
    shared grid (whole-minute boundaries for the 60s default) so their
    timestamps coincide and the multi-series line renders. Capped at the span
    so a very short custom range still yields a window that fits inside it.
    """
    span = max(1, end - start)
    every = max(1, span // max(1, points))
    return min(max(every, min_window), span)


class InfluxClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def query_series(
        self, itemids: list[str], start: int, end: int, points: int, fn: str
    ) -> dict[str, list[tuple[float, float]]]:
        s = self._settings
        flux = build_flux(
            s.influx_bucket,
            itemids,
            start,
            end,
            choose_every(start, end, points, s.influx_min_window_seconds),
            fn,
        )
        try:
            async with httpx.AsyncClient(timeout=s.influx_timeout) as client:
                res = await client.post(
                    f"{s.influx_url.rstrip('/')}/api/v2/query",
                    params={"org": s.influx_org},
                    headers={
                        "Authorization": f"Token {s.influx_token}",
                        "Content-Type": "application/vnd.flux",
                        "Accept": "application/csv",
                    },
                    content=flux,
                )
        except httpx.TimeoutException as e:
            raise HTTPException(504, "InfluxDB timeout") from e
        except httpx.HTTPError as e:
            raise HTTPException(502, f"InfluxDB unreachable: {e.__class__.__name__}") from e

        if res.status_code != 200:
            logger.warning("influx query failed: %s %s", res.status_code, res.text[:200])
            raise HTTPException(502, f"InfluxDB returned HTTP {res.status_code}")

        return _parse_annotated_csv(res.text, itemids)


def _parse_annotated_csv(text: str, itemids: list[str]) -> dict[str, list[tuple[float, float]]]:
    """Parse Influx annotated CSV into {itemid: [(unix_ts, value), ...]}."""
    from datetime import datetime

    series: dict[str, list[tuple[float, float]]] = {i: [] for i in itemids}
    header: list[str] | None = None
    for row in csv.reader(io.StringIO(text)):
        if not row or row[0].startswith("#"):
            header = None if row and row[0].startswith("#datatype") else header
            continue
        if header is None and "_time" in row and "_value" in row:
            header = row
            continue
        if header is None:
            continue
        record = dict(zip(header, row, strict=False))
        itemid = record.get("itemid")
        t_raw = record.get("_time")
        v_raw = record.get("_value")
        if not itemid or itemid not in series or not t_raw or v_raw in (None, ""):
            continue
        try:
            ts = datetime.fromisoformat(t_raw.replace("Z", "+00:00")).timestamp()
            series[itemid].append((ts, float(v_raw)))
        except ValueError:
            continue
    for pts in series.values():
        pts.sort(key=lambda p: p[0])
    return series
