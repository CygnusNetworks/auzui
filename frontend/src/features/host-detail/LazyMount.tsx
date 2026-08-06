import { useEffect, useRef, useState } from "react";

/**
 * Viewport gate for host-detail's ChartCards.
 *
 * The overflow cutoff (`MAX_CHARTS_PER_SECTION`, "N weitere anzeigen") that
 * used to cap a section at 8 mounted charts was removed so every graph shows
 * expanded — but that meant every ChartCard's `useTimeseries` query starts
 * mounting (and querying) at once. Measured against real Zabbix on
 * `icx7750` (1861 items, one "Network" section with 199 charts): all 199
 * queries fired simultaneously, the browser's per-origin connection limit
 * was exhausted (`net::ERR_INSUFFICIENT_RESOURCES`, 4872 console errors),
 * the backend buckled under the burst and returned HTTP 500s, and nearly
 * every card sat on "History query slow or failed" after 12s. `LazyMount`
 * replaces the overflow cutoff with a viewport cutoff: a chart's query only
 * starts once the card is about to scroll into view, so at most a screenful
 * (plus the `rootMargin` prefetch band) of queries run concurrently,
 * regardless of how many charts the section has.
 *
 * Once visible, a card stays mounted permanently (no re-hiding on scroll
 * out). ChartCard tracks empty/constant state across renders and reports it
 * up to DashboardSection; unmounting on scroll-out would drop that state and
 * the chart's live query, and remounting would re-run the query and flash
 * back to a loading spinner every time it re-enters the viewport.
 */
export function LazyMount({
  children,
  eager = false,
  placeholderHeight = 267,
  placeholderClassName = "rounded-lg border border-line bg-surface",
}: {
  children: React.ReactNode;
  /** Skip the gate and mount immediately — used for the first N "above the fold" cards so nothing flickers in on load. */
  eager?: boolean;
  /** Height (px) of the placeholder div, matched to ChartCard's rendered height so scroll position doesn't jump when the real card mounts. */
  placeholderHeight?: number;
  placeholderClassName?: string;
}) {
  const [visible, setVisible] = useState(eager);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (visible) return;
    const node = ref.current;
    if (!node) return;

    if (typeof IntersectionObserver === "undefined") {
      // jsdom (tests) and old browsers: no observer available, mount right away.
      setVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.unobserve(node);
          observer.disconnect();
        }
      },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [visible]);

  if (visible) return <>{children}</>;

  return <div ref={ref} aria-hidden="true" className={placeholderClassName} style={{ height: placeholderHeight }} />;
}
