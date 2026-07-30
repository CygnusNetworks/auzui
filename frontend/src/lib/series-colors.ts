/**
 * Zentrale, deterministische Serien-Farbzuordnung für den Metrik-Browser.
 *
 * Eine Serie (= ausgewähltes Item) bekommt ihre Farbe aus ihrem Index in der
 * geordneten Auswahl — konsistent zwischen Matrix-Zelle, Panel-Legende und
 * uPlot-Linie. Basis sind die vier `--color-chart-*`-Tokens; darüber hinaus
 * werden weitere Abstufungen erzeugt, indem die Basisfarbe zu Weiß/Schwarz
 * gemischt wird ("tier"). So bleiben auch >4 Serien unterscheidbar.
 *
 * Die reinen, testbaren Kerne sind `seriesPaletteSlot` und `shadeHex`; die
 * DOM-abhängige Auflösung (`resolveSeriesColor`) liest die CSS-Variablen des
 * aktiven Themes und mischt mit demselben `shadeHex`, damit Canvas (uPlot) und
 * DOM (Matrix) exakt dieselbe Farbe zeigen.
 */

export const CHART_PALETTE_VARS = [
  "--color-chart-1",
  "--color-chart-2",
  "--color-chart-3",
  "--color-chart-4",
] as const;

const PALETTE_SIZE = CHART_PALETTE_VARS.length;

/** Fallback-Basisfarben (Light-Theme), falls getComputedStyle nichts liefert (z. B. Tests/SSR). */
const FALLBACK_HEX = ["#3b6be8", "#7050e0", "#b96a0a", "#1f8a96"] as const;

export interface SeriesPaletteSlot {
  /** Index in CHART_PALETTE_VARS (0..3). */
  paletteIndex: number;
  /** Wie oft die Palette schon umgelaufen ist — steuert die Aufhellung/Abdunklung. */
  tier: number;
}

/** Rein: zerlegt einen Serien-Index in Paletten-Slot + Tier (zyklisch über 4 Basisfarben). */
export function seriesPaletteSlot(index: number): SeriesPaletteSlot {
  const i = index < 0 ? 0 : Math.floor(index);
  return { paletteIndex: i % PALETTE_SIZE, tier: Math.floor(i / PALETTE_SIZE) };
}

function clampChannel(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = hex.trim().replace(/^#/, "");
  if (m.length === 3) {
    const r = parseInt(m[0]! + m[0]!, 16);
    const g = parseInt(m[1]! + m[1]!, 16);
    const b = parseInt(m[2]! + m[2]!, 16);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  if (m.length === 6) {
    const r = parseInt(m.slice(0, 2), 16);
    const g = parseInt(m.slice(2, 4), 16);
    const b = parseInt(m.slice(4, 6), 16);
    return Number.isNaN(r + g + b) ? null : { r, g, b };
  }
  return null;
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => clampChannel(n).toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Rein: mischt `hex` zu Weiß (t>0) bzw. Schwarz (t<0) um den Anteil |t|.
 * Ungültiges `hex` wird unverändert zurückgegeben.
 */
export function mixHex(hex: string, target: "white" | "black", t: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  const to = target === "white" ? 255 : 0;
  const mix = (c: number) => c + (to - c) * t;
  return toHex(mix(rgb.r), mix(rgb.g), mix(rgb.b));
}

/**
 * Rein: liefert die konkrete Farbe für ein `tier` einer Basisfarbe.
 * tier 0 = Basis, danach abwechselnd heller/dunkler, damit benachbarte
 * Umläufe klar unterscheidbar bleiben.
 */
export function shadeHex(baseHex: string, tier: number): string {
  if (tier <= 0) return baseHex;
  // tier 1 → heller, 2 → dunkler, 3 → deutlich heller, 4 → deutlich dunkler …
  const steps: Array<["white" | "black", number]> = [
    ["white", 0.42],
    ["black", 0.34],
    ["white", 0.66],
    ["black", 0.55],
  ];
  const [target, amount] = steps[(tier - 1) % steps.length]!;
  return mixHex(baseHex, target, amount);
}

function cssVar(name: string): string {
  if (typeof document === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * DOM-abhängig: löst die konkrete Farbe eines Serien-Index gegen das aktive
 * Theme auf. Für Canvas (uPlot) UND DOM (Matrix) — beide über denselben
 * `shadeHex`, damit die Farben deckungsgleich sind.
 */
export function resolveSeriesColor(index: number): string {
  const { paletteIndex, tier } = seriesPaletteSlot(index);
  const base = cssVar(CHART_PALETTE_VARS[paletteIndex]!) || FALLBACK_HEX[paletteIndex]!;
  return shadeHex(base, tier);
}
