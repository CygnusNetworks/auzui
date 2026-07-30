import { useState } from "react";
import type { LogSource } from "@auzui/logs";
import { LogRows } from "../../components/LogRows";
import { useDebouncedValue } from "../../lib/use-debounced-value";
import { useLogServers } from "../../lib/use-logs";
import { useHostLogs } from "./use-host-logs";
import { useT } from "../../lib/i18n";

const DEBOUNCE_MS = 400;

/**
 * "Logs"-Sektion des Host Deep-Dive (PLAN.md Abschnitt H / M4-Teil). Range ist
 * an die globale Chart-Range der Seite gekoppelt — ein Brush in irgendeinem
 * Chart refetcht auch die Logs. Nur gerendert, wenn /api/logs/status enabled
 * ist (HostDetailPage prüft das über useLogsEnabled).
 */
export function LogsPanel({
  source,
  hostId,
  range,
}: {
  source: LogSource;
  hostId: string;
  range: { from: number; to: number };
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);

  const serversQuery = useLogServers(source);
  const allServers = serversQuery.data ?? [];
  const multiServer = allServers.length > 1;
  // Panel-local server selection (empty = all); a small dropdown in the head.
  const [selectedServers, setSelectedServers] = useState<string[]>([]);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useHostLogs(
    source,
    hostId,
    range,
    debouncedQuery,
    selectedServers,
  );
  const messages = data?.pages.flatMap((p) => p.messages) ?? [];
  const matchedSources = data?.pages[0]?.matchedSources;
  const total = data?.pages[0]?.total;

  return (
    <div className="rounded-lg border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t("hostDetail.logs.badge")}
        </span>
        <span className="text-sm font-semibold">{t("hostDetail.logs.title")}</span>
        {matchedSources && matchedSources.length > 0 && (
          <span className="text-[11.5px] text-ink-muted">
            {t("hostDetail.logs.matched")}{" "}
            {matchedSources.map((s, i) => (
              <span key={s}>
                {i > 0 && ", "}
                <b className="font-mono text-ink-2">{s}</b>
              </span>
            ))}
          </span>
        )}
        {multiServer && (
          <select
            value={selectedServers.length === 1 ? selectedServers[0] : ""}
            onChange={(e) => setSelectedServers(e.target.value ? [e.target.value] : [])}
            aria-label={t("logs.serversLabel")}
            className="ml-auto rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink"
          >
            <option value="">{t("logs.serversLabel")} *</option>
            {allServers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("hostDetail.logs.filterPlaceholder")}
          className={`min-w-[180px] rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-ink ${multiServer ? "" : "ml-auto"}`}
        />
      </div>

      {isLoading ? (
        <div className="p-4 text-sm text-ink-2">{t("hostDetail.logs.loading")}</div>
      ) : isError ? (
        <div className="p-4 text-sm text-sev-warn">{t("hostDetail.logs.loadError")}</div>
      ) : messages.length === 0 ? (
        <div className="p-4 text-sm text-ink-2">
          {matchedSources && matchedSources.length === 0
            ? t("hostDetail.logs.noSource")
            : t("hostDetail.logs.noResults")}
        </div>
      ) : (
        <>
          <div className="max-h-96 overflow-y-auto">
            <LogRows messages={messages} showServer={multiServer} />
          </div>
          {hasNextPage && (
            <div className="border-t border-line-soft p-2 text-center">
              <button
                type="button"
                onClick={() => void fetchNextPage()}
                disabled={isFetchingNextPage}
                className="rounded-md border border-line px-3 py-1 font-mono text-[11px] text-ink-2 hover:bg-surface-2 disabled:opacity-50"
              >
                {isFetchingNextPage
                  ? t("hostDetail.logs.loadingMore")
                  : t("hostDetail.logs.loadMore", messages.length, total)}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
