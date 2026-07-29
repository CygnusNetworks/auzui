import { TimeChart, type TimeChartProps } from "./TimeChart";

/**
 * Wraps TimeChart with the loading/slow-failure/empty states shared by
 * host-detail (ChartCard) and the metrics compare modal (PLAN.md M3
 * Degradations-Polish) — kept out of TimeChart itself so the uPlot wrapper
 * stays focused on just rendering series.
 */
export function TimeChartPanel({
  isLoading,
  slow,
  onRetry,
  height = 220,
  ...chartProps
}: TimeChartProps & {
  isLoading: boolean;
  /** True when the query failed or timed out on the (Influx-less) Zabbix-API path. */
  slow: boolean;
  onRetry: () => void;
}) {
  const hasData = chartProps.series.some((s) => s.points.length > 0);

  if (slow) {
    return (
      <div
        className="flex flex-col items-center justify-center gap-2 rounded-md border border-line-soft bg-surface-2 px-4 text-center"
        style={{ height }}
      >
        <span className="text-[12.5px] text-ink-2">
          History-Abfrage langsam oder fehlgeschlagen — kürzeren Zeitraum wählen.
        </span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] font-semibold text-ink-2"
        >
          Erneut versuchen
        </button>
      </div>
    );
  }

  if (isLoading && !hasData) {
    return (
      <div className="flex items-center justify-center text-[12px] text-ink-2" style={{ height }}>
        Lade…
      </div>
    );
  }

  if (!isLoading && !hasData) {
    return (
      <div
        className="flex items-center justify-center text-[12px] text-ink-2"
        style={{ height }}
      >
        Keine Daten im Zeitraum.
      </div>
    );
  }

  return <TimeChart {...chartProps} height={height} />;
}
