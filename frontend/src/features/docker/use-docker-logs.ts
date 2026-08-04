import { useEffect, useRef, useState } from "react";
import type { DockerLogLine, DockerSource } from "@auzui/docker";
import { mergeLogLines } from "../../lib/docker";

/** Live-log poll cadence (auzui-docker-plan.md D6 / CONTRACT.md). */
const LIVE_POLL_MS = 2_500;

/**
 * Converts the opaque RFC3339Nano `cursor` from a logs response into the
 * Unix-seconds `since` the gateway's GET .../logs accepts (DockerLogsParams.since
 * is a plain number). Pure — no I/O; exported for unit testing. Returns
 * undefined for a cursor that doesn't parse as a timestamp (never sent to
 * the gateway as `since` in that case, so the poll just re-fetches with tail).
 */
export function cursorToSinceSeconds(cursor: string): number | undefined {
  const ms = Date.parse(cursor);
  return Number.isFinite(ms) ? ms / 1000 : undefined;
}

export interface DockerLogsHistoryParams {
  since?: number;
  until?: number;
  tail?: number;
}

export interface UseDockerLogsResult {
  lines: DockerLogLine[];
  isLoading: boolean;
  error: unknown;
}

/**
 * Historical range fetch (RangePicker-driven since/until/tail) plus an
 * optional cursor-based live poll every 2.5s (plan D6). The live interval is
 * torn down on every dependency change AND on unmount via the effect's
 * cleanup, so switching tabs, closing the panel, or turning `live` off always
 * stops the polling cleanly — no leaked timers.
 */
export function useDockerLogs(
  source: DockerSource,
  hostId: string | undefined,
  cid: string | undefined,
  history: DockerLogsHistoryParams,
  live: boolean,
): UseDockerLogsResult {
  const [lines, setLines] = useState<DockerLogLine[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cursorRef = useRef<string | null>(null);

  // Historical (re-)load: whenever the target container or the requested
  // range/tail changes, replace the buffer from scratch and reset the cursor.
  useEffect(() => {
    if (!source.enabled || !hostId || !cid) {
      setLines([]);
      cursorRef.current = null;
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    setIsLoading(true);
    source
      .logs(hostId, cid, { ...history, signal: controller.signal })
      .then((res) => {
        if (cancelled) return;
        setLines(res.lines);
        cursorRef.current = res.cursor;
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
    // Deps intentionally destructure `history` field-by-field so an
    // equivalent-but-freshly-created options object doesn't retrigger this.
  }, [source, hostId, cid, history.since, history.until, history.tail]);

  // Live cursor poll. Depends only on the identity of what's being tailed —
  // NOT on `lines`, so it never restarts on its own updates.
  useEffect(() => {
    if (!live || !source.enabled || !hostId || !cid) return;
    let cancelled = false;
    const id = setInterval(() => {
      const cursor = cursorRef.current;
      const since = cursor ? cursorToSinceSeconds(cursor) : history.since;
      source
        .logs(hostId, cid, { since, stdout: true, stderr: true })
        .then((res) => {
          if (cancelled) return;
          if (res.lines.length > 0) setLines((prev) => mergeLogLines(prev, res.lines));
          if (res.cursor) cursorRef.current = res.cursor;
        })
        .catch((err) => {
          if (!cancelled) setError(err);
        });
    }, LIVE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [live, source, hostId, cid]);

  return { lines, isLoading, error };
}
