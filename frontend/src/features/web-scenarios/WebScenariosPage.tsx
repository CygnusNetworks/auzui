import { useMemo } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import {
  countByStatus,
  groupScenariosByHost,
  matchesScenarioSearch,
  sortWebScenarios,
  totalResponseSeconds,
  type EnrichedWebScenario,
  type WebScenarioHostGroup,
  type WebScenarioSortKey,
} from "../../lib/web-scenarios";
import { formatAge } from "../../lib/problems";
import { useLocale, useT } from "../../lib/i18n";
import { DetailPanel } from "./DetailPanel";
import { statusDotClass } from "./StatusBadge";
import { useWebScenarios } from "./use-web-scenarios";
import { validateWebScenariosSearch, type WebScenariosSearch } from "./search-params";

export function WebScenariosPage() {
  const t = useT();
  const { locale } = useLocale();
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateWebScenariosSearch(rawSearch);
  const navigate = useNavigate();
  const { scenarios, isLoading, isError, error, refetch } = useWebScenarios();

  function updateSearch(patch: Partial<WebScenariosSearch>) {
    void navigate({
      to: "/web-scenarios",
      search: (prev: WebScenariosSearch) => ({ ...prev, ...patch }),
      replace: true,
    });
  }

  const sortKey: WebScenarioSortKey = "status";
  const query = search.q ?? "";

  const filtered = useMemo(() => {
    const matching = query.trim() ? scenarios.filter((s) => matchesScenarioSearch(s, query)) : scenarios;
    return sortWebScenarios(matching, sortKey);
  }, [scenarios, query]);

  const groups = useMemo(() => groupScenariosByHost(filtered), [filtered]);

  const selected = useMemo(() => {
    if (search.scenario !== undefined) {
      return filtered.find((s) => s.httptest.httptestid === search.scenario);
    }
    return filtered[0];
  }, [filtered, search.scenario]);

  const counts = countByStatus(scenarios);

  return (
    <div className="mx-auto max-w-[1400px] px-3 pb-16 pt-4.5 min-[700px]:px-5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">{t("webScenarios.title")}</h1>
        <span className="text-[13px] text-ink-2">{t("webScenarios.subtitle")}</span>
        {!isLoading && !isError && scenarios.length > 0 && (
          <span className="rounded-full border border-accent/35 bg-accent-soft px-2.5 py-0.5 font-mono text-[11px] text-accent">
            {t("webScenarios.summary", scenarios.length, counts.failed, counts.degraded)}
          </span>
        )}
      </div>

      {isError ? (
        <ErrorPanel error={error} onRetry={() => refetch()} />
      ) : (
        <div className="grid grid-cols-[1fr_350px] items-start gap-3.5 max-[1100px]:grid-cols-1">
          <div className="rounded-lg border border-line bg-surface">
            <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
              <input
                type="text"
                value={query}
                onChange={(e) => updateSearch({ q: e.target.value || undefined })}
                placeholder={t("webScenarios.searchPlaceholder")}
                className="min-w-[200px] flex-1 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink max-[700px]:w-full"
              />
            </div>

            <div className={`${ROW_GRID} border-b border-line-soft px-3.5 py-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted`}>
              <span />
              <span>{t("webScenarios.colScenario")}</span>
              <span className="hidden min-[700px]:block">{t("webScenarios.colSteps")}</span>
              <span>{t("webScenarios.colResponseTime")}</span>
              <span>{t("webScenarios.colLastCheck")}</span>
            </div>

            {isLoading ? (
              <div className="p-6 text-sm text-ink-2">{t("webScenarios.loading")}</div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 px-6 py-16 text-center">
                <div className="text-sm font-semibold">{t("webScenarios.empty")}</div>
                <div className="text-xs text-ink-2">{t("webScenarios.emptyHint")}</div>
              </div>
            ) : (
              <div>
                {groups.map((group) => (
                  <section key={group.hostId}>
                    <HostGroupHeader group={group} />
                    {group.scenarios.map((s) => (
                      <ScenarioRow
                        key={s.httptest.httptestid}
                        scenario={s}
                        selected={selected?.httptest.httptestid === s.httptest.httptestid}
                        onSelect={() => updateSearch({ scenario: s.httptest.httptestid })}
                        locale={locale}
                      />
                    ))}
                  </section>
                ))}
              </div>
            )}
          </div>

          <aside className="rounded-lg border border-line bg-surface">
            <DetailPanel scenario={selected} />
          </aside>
        </div>
      )}
    </div>
  );
}

/** Shared by the column header and every row so they stay aligned. */
const ROW_GRID = "grid grid-cols-[20px_1fr_60px_100px_90px] items-center gap-2.5";

function HostGroupHeader({ group }: { group: WebScenarioHostGroup }) {
  const t = useT();
  return (
    // top-[52px] parks the header just under AppShell's sticky top bar.
    <div className="sticky top-[52px] z-10 flex items-center gap-2 border-b border-line-soft bg-surface-2/95 px-3.5 py-1.5 backdrop-blur">
      <span className={`h-2 w-2 flex-shrink-0 rounded-full ${statusDotClass(group.worstStatus)}`} />
      <Link
        to="/hosts/$hostId"
        params={{ hostId: group.hostId }}
        className="min-w-0 truncate font-mono text-[12px] font-semibold text-ink hover:text-accent"
      >
        {group.hostName}
      </Link>
      <span className="ml-auto flex-shrink-0 font-mono text-[10.5px] text-ink-muted">
        {t("webScenarios.groupSummary", group.scenarios.length, group.counts.failed, group.counts.degraded)}
      </span>
    </div>
  );
}

function ScenarioRow({
  scenario,
  selected,
  onSelect,
  locale,
}: {
  scenario: EnrichedWebScenario;
  selected: boolean;
  onSelect: () => void;
  locale: ReturnType<typeof useLocale>["locale"];
}) {
  const t = useT();
  const totalMs = Math.round(totalResponseSeconds(scenario) * 1000);
  const lastClock = scenario.failItem?.lastclock ?? scenario.steps[0]?.responseTimeItem?.lastclock;

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`${ROW_GRID} w-full border-b border-line-soft px-3.5 py-2.5 text-left text-[12.5px] last:border-b-0 hover:bg-surface-2 ${selected ? "bg-accent-soft" : ""}`}
    >
      <span className={`h-2 w-2 rounded-sm ${statusDotClass(scenario.status)}`} />
      <span className="min-w-0">
        <div className="truncate font-semibold text-ink">{scenario.httptest.name}</div>
        <div className="truncate font-mono text-[11px] text-ink-muted">{scenario.steps[0]?.step.url ?? ""}</div>
      </span>
      <span className="hidden font-mono text-[12px] text-ink-2 min-[700px]:block">
        {t("webScenarios.stepCount", scenario.steps.length)}
      </span>
      <span className="font-mono text-[12.5px] tabular-nums text-ink-2">{totalMs > 0 ? `${totalMs} ms` : "—"}</span>
      <span className="font-mono text-[11.5px] text-ink-2">
        {lastClock ? formatAge(Number(lastClock), undefined, locale) : "—"}
      </span>
    </button>
  );
}

function ErrorPanel({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();
  const message = error instanceof Error ? error.message : t("webScenarios.unknownError");
  return (
    <div className="rounded-lg border border-sev-high/40 bg-surface p-6 text-center">
      <div className="mb-1 text-sm font-semibold text-sev-high">{t("webScenarios.loadError")}</div>
      <div className="mb-3 text-xs text-ink-2">{message}</div>
      <button
        type="button"
        onClick={onRetry}
        className="rounded-md border border-line bg-surface-2 px-3 py-1.5 text-xs text-ink-2"
      >
        {t("webScenarios.retry")}
      </button>
    </div>
  );
}
