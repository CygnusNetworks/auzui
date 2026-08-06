import type { Dashboard, DashboardChart, DashboardSection } from "../../lib/auto-dashboard";

/**
 * Reine Filterfunktion für das Host-Deep-Dive-Dashboard (Textfilter +
 * optionaler Template-Filter). Kein Netzwerkzugriff, keine UI-Zustände.
 *
 * Textfilter: case-insensitive Substring-Match auf Chart-Titel, jedes
 * `chart.seriesLabels[i]`, sowie `item.name`/`item.key_` eines Chart-Items.
 * Matcht zusätzlich der Sektionsname (`section.section`), bleiben alle
 * Charts der Sektion erhalten. `textItem`s (Status-Parameter) matchen über
 * `item.name`/`item.key_`.
 *
 * Template-Filter (`templateItemIds`, optional): ein Chart bleibt nur, wenn
 * mindestens eines seiner Items im Set liegt; ein `textItem` bleibt nur, wenn
 * seine `itemid` im Set liegt. Text- und Template-Filter sind UND-verknüpft.
 *
 * Stabilität: bei leerem Text und ohne `templateItemIds` wird `dashboard`
 * unverändert (identische Referenz) zurückgegeben, damit useMemo-Konsumenten
 * nicht unnötig neu rendern.
 */
export function filterDashboard(
  dashboard: Dashboard,
  opts: { text: string; templateItemIds?: ReadonlySet<string> },
): Dashboard {
  const text = opts.text.trim().toLowerCase();
  const templateItemIds = opts.templateItemIds;

  if (text === "" && !templateItemIds) return dashboard;

  const sections = dashboard.sections
    .map((section) => filterSection(section, text, templateItemIds))
    .filter((section): section is DashboardSection => section !== undefined);

  const textItems = dashboard.textItems.filter((item) => {
    if (templateItemIds && !templateItemIds.has(item.itemid)) return false;
    if (text === "") return true;
    return matchesText(item.name, text) || matchesText(item.key_, text);
  });

  return {
    sections,
    textItems,
    generatedFromItemCount: dashboard.generatedFromItemCount,
  };
}

function filterSection(
  section: DashboardSection,
  text: string,
  templateItemIds: ReadonlySet<string> | undefined,
): DashboardSection | undefined {
  const sectionNameMatches = text !== "" && matchesText(section.section, text);

  const charts = section.charts.filter((chart) => {
    if (templateItemIds && !chart.items.some((item) => templateItemIds.has(item.itemid))) return false;
    if (text === "" || sectionNameMatches) return true;
    return chartMatchesText(chart, text);
  });

  if (charts.length === 0) return undefined;
  return { ...section, charts };
}

function chartMatchesText(chart: DashboardChart, text: string): boolean {
  if (matchesText(chart.title, text)) return true;
  if (chart.seriesLabels.some((label) => matchesText(label, text))) return true;
  return chart.items.some((item) => matchesText(item.name, text) || matchesText(item.key_, text));
}

function matchesText(value: string | undefined, text: string): boolean {
  return (value ?? "").toLowerCase().includes(text);
}
