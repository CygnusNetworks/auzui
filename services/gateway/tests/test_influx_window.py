"""Unit tests for the Influx downsampling window calculation.

Regression guard for the "blank chart on short ranges" bug: choosing an
aggregateWindow finer than the item poll interval scatters items sampled a
few seconds apart onto non-coinciding timestamps, and the frontend then
renders a blank multi-series chart. `choose_every` must floor the window so
all items share one grid (whole-minute boundaries by default).
"""

from auzui_gateway.influx import build_flux, choose_every

DAY = 86_400


def test_short_ranges_are_floored_to_min_window():
    # 15m and 1h with the default 800-point budget would otherwise pick a
    # 1s / 4s window (finer than a 60s poll) and misalign the series.
    assert choose_every(0, 15 * 60, 800, min_window=60) == 60
    assert choose_every(0, 3600, 800, min_window=60) == 60


def test_long_ranges_keep_their_natural_window():
    # 6h/24h already exceed the floor, so the point budget still drives them.
    assert choose_every(0, 6 * 3600, 800, min_window=60) == 60  # 21600//800 = 27 -> 60
    assert choose_every(0, DAY, 800, min_window=60) == 108  # above the floor, untouched
    assert choose_every(0, 30 * DAY, 800, min_window=60) == 3240


def test_window_never_exceeds_the_span():
    # A custom range shorter than the floor must still fit one window inside it
    # (never larger than the span, which would collapse to a single point).
    assert choose_every(0, 30, 800, min_window=60) == 30
    assert choose_every(1000, 1010, 800, min_window=60) == 10


def test_default_min_window_is_a_noop_for_the_pure_function():
    # Without a floor the function is the plain span/points heuristic.
    assert choose_every(0, 800, 800) == 1
    assert choose_every(0, 8000, 800) == 10


def test_min_window_aligns_flux_window_argument():
    flux = build_flux("b", ["1", "2"], 0, 15 * 60, choose_every(0, 15 * 60, 800, 60), "last")
    assert "aggregateWindow(every: 60s" in flux
