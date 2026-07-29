import { useEffect, useState } from "react";
import { nowSeconds, presetSeconds, rangeFromPreset, type RangePreset } from "@auzui/timeseries";
import { useT } from "../lib/i18n";

const PRESETS: RangePreset[] = ["15m", "1h", "6h", "24h", "7d", "30d"];
const AUTOREFRESH_MS = 30_000;

export interface RangeValue {
  from: number;
  to: number;
}

/**
 * Chips 15m/1h/6h/24h/7d/30d + custom (two datetime-local inputs). Fully
 * controlled: {from,to} are Unix seconds. "live" keeps `to` pinned to now
 * and refreshes every 30s; picking a preset re-enables live, custom range
 * disables it.
 */
export function RangePicker({
  value,
  onChange,
  live,
  onLiveChange,
}: {
  value: RangeValue;
  onChange: (range: RangeValue) => void;
  live: boolean;
  onLiveChange: (live: boolean) => void;
}) {
  const t = useT();
  const [activePreset, setActivePreset] = useState<RangePreset | "custom">("1h");
  const [customOpen, setCustomOpen] = useState(false);

  useEffect(() => {
    if (!live) return;
    const id = setInterval(() => {
      const span = value.to - value.from;
      const to = nowSeconds();
      onChange({ from: to - span, to });
    }, AUTOREFRESH_MS);
    return () => clearInterval(id);
  }, [live, value.from, value.to, onChange]);

  function pickPreset(preset: RangePreset) {
    setActivePreset(preset);
    setCustomOpen(false);
    onLiveChange(true);
    onChange(rangeFromPreset(preset));
  }

  function toLocalInput(seconds: number): string {
    const d = new Date(seconds * 1000);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  }

  function fromLocalInput(local: string): number {
    return Math.floor(new Date(local).getTime() / 1000);
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <div className="inline-flex flex-wrap gap-0.5 rounded-md bg-surface-3 p-0.5">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => pickPreset(preset)}
            className={`rounded px-2 py-1 font-mono text-[11px] ${
              activePreset === preset ? "bg-surface font-semibold text-ink" : "text-ink-2"
            }`}
          >
            {preset}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setActivePreset("custom");
            setCustomOpen((v) => !v);
            onLiveChange(false);
          }}
          className={`rounded px-2 py-1 font-mono text-[11px] ${
            activePreset === "custom" ? "bg-surface font-semibold text-ink" : "text-ink-2"
          }`}
        >
          {t("rangePicker.custom")}
        </button>
      </div>

      {customOpen && (
        <div className="flex items-center gap-1.5">
          <input
            type="datetime-local"
            value={toLocalInput(value.from)}
            onChange={(e) => onChange({ ...value, from: fromLocalInput(e.target.value) })}
            className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink"
          />
          <span className="text-ink-muted">–</span>
          <input
            type="datetime-local"
            value={toLocalInput(value.to)}
            onChange={(e) => onChange({ ...value, to: fromLocalInput(e.target.value) })}
            className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink"
          />
        </div>
      )}

      <button
        type="button"
        onClick={() => onLiveChange(!live)}
        title={t("rangePicker.liveRefresh")}
        className={`rounded-full border px-2.5 py-1 font-mono text-[10.5px] ${
          live
            ? "border-accent/40 bg-accent-soft text-accent"
            : "border-line text-ink-muted"
        }`}
      >
        ● live
      </button>
    </div>
  );
}

export { presetSeconds };
