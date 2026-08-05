import { Link } from "@tanstack/react-router";
import type { EnrichedWebScenario } from "../../lib/web-scenarios";
import { useAppConfig } from "../../lib/use-app-config";
import { useT } from "../../lib/i18n";
import { StatusBadge } from "./StatusBadge";
import { StepResponseChart } from "./StepResponseChart";
import { useToggleWebScenario, useWebScenarioDetail } from "./use-web-scenarios";

const DAY_SECONDS = 86_400;

/** Shared with TimeChartPanel's slow/failed state — same wording, same escape hatch. */
function SlowOrFailedHint({ onRetry }: { onRetry: () => void }) {
  const t = useT();
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-line-soft bg-surface-2 px-2.5 py-2 text-[11.5px] text-ink-2">
      <span>{t("timeChart.slowOrFailed")}</span>
      <button
        type="button"
        onClick={onRetry}
        className="flex-shrink-0 rounded-md border border-line bg-surface px-2 py-0.5 text-[11px] font-semibold text-ink-2"
      >
        {t("timeChart.retry")}
      </button>
    </div>
  );
}

export function DetailPanel({ scenario }: { scenario: EnrichedWebScenario | undefined }) {
  const t = useT();
  const { data: config } = useAppConfig();
  const { stepHistory, availability, slow, refetch } = useWebScenarioDetail(scenario);
  const toggle = useToggleWebScenario();

  if (!scenario) {
    return <div className="p-3.5 text-sm text-ink-2">{t("webScenarios.detailPanel.noneSelected")}</div>;
  }

  const now = Math.floor(Date.now() / 1000);
  const oldUiUrl = config?.zabbix_ui_url
    ? `${config.zabbix_ui_url}/httpdetails.php?httptestid=${encodeURIComponent(scenario.httptest.httptestid)}`
    : undefined;

  const avgTotalMs = Math.round(
    (stepHistory.reduce((sum, s) => sum + s.points.reduce((a, p) => a + p.value, 0), 0) /
      Math.max(1, stepHistory.reduce((n, s) => n + s.points.length, 0))) *
      1000,
  );

  return (
    <div>
      <div className="border-b border-line-soft p-3.5">
        <StatusBadge status={scenario.status} />
        <div className="mt-2 text-sm font-semibold">{scenario.httptest.name}</div>
        <div className="mt-1 text-[11.5px] text-ink-muted">
          <span className="font-mono text-ink-2">{scenario.hostName}</span> ·{" "}
          {t("webScenarios.detailPanel.checkedEvery", scenario.httptest.delay)}
        </div>
      </div>

      <div className="border-b border-line-soft p-3.5">
        <div className="mb-2 flex justify-between font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          <span>{t("webScenarios.detailPanel.steps")}</span>
          <span>{t("webScenarios.detailPanel.stepsTotal", scenario.steps.length)}</span>
        </div>
        <div className="flex flex-col">
          {scenario.steps.map((s, i) => {
            const failed = scenario.failedStepNo === Number(s.step.no);
            const ms =
              s.responseTimeItem?.lastvalue !== undefined
                ? Math.round(Number(s.responseTimeItem.lastvalue) * 1000)
                : undefined;
            const code = s.responseCodeItem?.lastvalue;
            return (
              <div
                key={s.step.httpstepid}
                className={`flex gap-2.5 border-t border-line-soft py-2 first:border-t-0 first:pt-0 ${failed ? "" : ""}`}
              >
                <span className="w-4 flex-shrink-0 pt-px font-mono text-[10.5px] font-bold text-ink-muted">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`text-[12.5px] font-semibold ${failed ? "text-sev-high" : ""}`}>
                      {s.step.name}
                    </span>
                    <span className="flex-shrink-0 font-mono text-[11.5px] tabular-nums text-ink-2">
                      {ms !== undefined ? `${ms} ms` : "—"}
                    </span>
                  </div>
                  <div className="mt-0.5 truncate font-mono text-[10.5px] text-ink-muted">{s.step.url}</div>
                  <div className="mt-0.5 text-[10.5px] text-ink-muted">
                    {failed ? (
                      <span className="font-semibold text-sev-high">
                        {t("webScenarios.detailPanel.failed")}
                        {scenario.lastError ? ` · ${scenario.lastError}` : ""}
                      </span>
                    ) : (
                      t(
                        "webScenarios.detailPanel.expect",
                        code
                          ? s.step.status_codes || String(code)
                          : s.step.status_codes || t("webScenarios.detailPanel.anyStatus"),
                      )
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-b border-line-soft p-3.5">
        <div className="mb-2 flex justify-between font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          <span>{t("webScenarios.detailPanel.responseTimeTitle")}</span>
          {!Number.isNaN(avgTotalMs) && avgTotalMs > 0 && (
            <span>{t("webScenarios.detailPanel.avgTotal", avgTotalMs)}</span>
          )}
        </div>
        {slow ? (
          <SlowOrFailedHint onRetry={refetch} />
        ) : (
          <StepResponseChart stepHistory={stepHistory} from={now - DAY_SECONDS} to={now} />
        )}
        {!slow && stepHistory.length > 0 && (
          <>
            <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-muted">
              <span>{t("webScenarios.detailPanel.hoursAgo")}</span>
              <span>{t("webScenarios.detailPanel.now")}</span>
            </div>
            <div className="mt-2.5 flex flex-col gap-1">
              {stepHistory.map((s, i) => {
                const latest = s.points.at(-1)?.value;
                return (
                  <div key={s.itemid} className="flex items-center gap-1.5 text-[11.5px]">
                    <span
                      className="h-2 w-2 flex-shrink-0 rounded-sm"
                      style={{ background: `var(--color-chart-${(i % 4) + 1})` }}
                    />
                    <span className="min-w-0 flex-1 truncate text-ink-2">{s.stepName}</span>
                    <span className="font-mono tabular-nums text-ink">
                      {latest !== undefined ? `${Math.round(latest * 1000)} ms` : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      <div className="border-b border-line-soft p-3.5">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("webScenarios.detailPanel.availabilityTitle")}
        </div>
        {slow ? (
          <SlowOrFailedHint onRetry={refetch} />
        ) : availability.length > 0 ? (
          <>
            <div className="flex h-[34px] items-end gap-0.5">
              {availability.map((day) => {
                const color =
                  day.availability < 95 ? "bg-sev-high" : day.availability < 99.5 ? "bg-sev-warn" : "bg-sev-ok";
                return (
                  <div
                    key={day.day}
                    title={`${day.availability.toFixed(2)}%`}
                    className={`flex-1 rounded-t-[2px] ${color}`}
                    style={{ height: `${Math.max(4, (day.availability / 100) * 34)}px` }}
                  />
                );
              })}
            </div>
            <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-muted">
              <span>{t("webScenarios.detailPanel.daysAgo")}</span>
              <span>{t("webScenarios.detailPanel.today")}</span>
            </div>
          </>
        ) : (
          <div className="text-[11.5px] text-ink-muted">{t("webScenarios.detailPanel.noHistory")}</div>
        )}
      </div>

      <div className="border-b border-line-soft p-3.5">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("webScenarios.detailPanel.actions")}
        </div>
        <button
          type="button"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate({ httptestid: scenario.httptest.httptestid, enable: !scenario.enabled })}
          className={
            scenario.enabled
              ? "rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
              : "rounded-md border border-accent/40 bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent"
          }
        >
          {scenario.enabled
            ? t("webScenarios.detailPanel.disable")
            : t("webScenarios.detailPanel.enable")}
        </button>
      </div>

      <div className="p-3.5">
        <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("webScenarios.detailPanel.context")}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Link
            to="/hosts/$hostId"
            params={{ hostId: scenario.hostId }}
            className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
          >
            {t("webScenarios.detailPanel.hostDeepDive")}
          </Link>
          {oldUiUrl && (
            <a
              href={oldUiUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2"
            >
              {t("webScenarios.detailPanel.openInOldUi")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
