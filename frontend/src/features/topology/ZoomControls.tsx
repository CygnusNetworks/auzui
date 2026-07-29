import { useT } from "../../lib/i18n";

/** Small zoom pill group, bottom-right of the canvas (PLAN.md "Gemeinsame Interaktion"). */
export function ZoomControls({
  onZoomIn,
  onZoomOut,
  onFit,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
}) {
  const t = useT();
  return (
    <div className="absolute bottom-3 right-3 inline-flex gap-0.5 rounded-lg border border-line bg-surface/90 p-0.5 shadow-sm backdrop-blur">
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
