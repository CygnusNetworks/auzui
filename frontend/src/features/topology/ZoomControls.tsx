import { useT } from "../../lib/i18n";

/** Small zoom pill group, bottom-right of the canvas (PLAN.md "Gemeinsame Interaktion"). */
export function ZoomControls({
  onZoomIn,
  onZoomOut,
  onFit,
  zoomLabel,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  /** Optional current zoom relative to fit, e.g. "1.0×" — small mono readout left of the buttons. */
  zoomLabel?: string;
}) {
  const t = useT();
  return (
    <div className="absolute bottom-3 right-3 inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface/90 p-0.5 shadow-sm backdrop-blur">
      {zoomLabel !== undefined && (
        <span className="px-1.5 font-mono text-[10px] tabular-nums text-ink-muted" aria-hidden>
          {zoomLabel}
        </span>
      )}
      <button
        type="button"
        onClick={onZoomOut}
        aria-label={t("topology.zoom.zoomOut")}
        className="h-6 w-6 rounded-md text-[13px] font-semibold text-ink-2 hover:bg-surface-2"
      >
        −
      </button>
      <button
        type="button"
        onClick={onFit}
        aria-label={t("topology.zoom.fit")}
        className="rounded-md px-2 text-[10.5px] font-semibold text-ink-2 hover:bg-surface-2"
      >
        {t("topology.zoom.fitLabel")}
      </button>
      <button
        type="button"
        onClick={onZoomIn}
        aria-label={t("topology.zoom.zoomIn")}
        className="h-6 w-6 rounded-md text-[13px] font-semibold text-ink-2 hover:bg-surface-2"
      >
        +
      </button>
    </div>
  );
}
