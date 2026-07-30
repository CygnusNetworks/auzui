/**
 * Multi-Panel-Gruppierung (Vorschlag D) — reine, deterministische Ableitung
 * der Graph-Panels aus den Serien-Einheiten. Eine Einheit = ein Panel.
 */

/**
 * Strippt Zabbix' `!`-Präfix aus einer Unit. In Zabbix bedeutet ein führendes
 * "!", dass die Unit ohne SI-Präfix-Skalierung angezeigt wird (z. B. "!C" für
 * Grad Celsius ohne k/M/…). Fürs Gruppieren zählt nur die eigentliche Einheit.
 */
export function stripUnit(units: string | undefined): string {
  const u = (units ?? "").trim();
  return u.startsWith("!") ? u.slice(1).trim() : u;
}

export interface UnitGroup<T> {
  /** Bereinigte Einheit ("" = ohne Einheit). */
  unit: string;
  series: T[];
}

/**
 * Gruppiert Serien nach (gestrippter) Einheit. Reihenfolge der Panels =
 * Reihenfolge des ersten Auftretens der Einheit in `series` — deterministisch
 * aus der Eingabe, ohne alphabetische Umsortierung, damit die Auswahlreihen-
 * folge (und damit die Farbzuordnung) nachvollziehbar bleibt.
 */
export function groupSeriesByUnit<T>(series: T[], getUnit: (item: T) => string | undefined): UnitGroup<T>[] {
  const groups = new Map<string, UnitGroup<T>>();
  const order: string[] = [];
  for (const item of series) {
    const unit = stripUnit(getUnit(item));
    let group = groups.get(unit);
    if (!group) {
      group = { unit, series: [] };
      groups.set(unit, group);
      order.push(unit);
    }
    group.series.push(item);
  }
  return order.map((u) => groups.get(u)!);
}
