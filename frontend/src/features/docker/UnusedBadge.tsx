import { useT } from "../../lib/i18n";

/**
 * Marks an image/volume/network nothing references — the prune candidate.
 *
 * Deliberately the same shape as the container rows' "↑ Update" badge (tinted
 * fill, hairline border of the same hue, mono caps-height text), because both
 * say the same kind of thing: this row wants a decision. It sits one step down
 * the severity ramp at `sev-avg`, so the two never read as the same state, and
 * it does not use the neutral chip styling of the container names beside it —
 * that made it look like just another, greyed-out container.
 */
export function UnusedBadge({ className = "" }: { className?: string }) {
  const t = useT();
  return (
    <span
      className={`shrink-0 whitespace-nowrap rounded-full border border-sev-avg/35 bg-sev-avg/15 px-1.5 font-mono text-[9.5px] leading-[15px] text-sev-avg ${className}`}
    >
      {t("docker.resourceLane.unused")}
    </span>
  );
}
