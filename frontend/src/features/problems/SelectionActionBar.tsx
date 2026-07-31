import { useEffect, useRef, useState } from "react";
import { useT } from "../../lib/i18n";
import { SuppressButton } from "./SuppressButton";
import { SeverityPills } from "./SeverityPills";
import type { Severity } from "../../lib/severity";

/**
 * In-toolbar action bar for the Problems "Auswahlmodus" (select mode). Unlike
 * the previous floating BulkActionBar, this lives at the top of the list so it
 * stays visible next to the filters. The optional comment is sent as the
 * message on every action (ack / un-ack / suppress / unsuppress / severity) —
 * event.acknowledge accepts a batch of eventids in a single mutation (see
 * use-acknowledge.ts).
 *
 * Actions reset the comment immediately; the parent clears the selection on
 * mutation success and keeps select mode active for the next batch.
 */
export function SelectionActionBar({
  count,
  pending,
  onConfirm,
  onRemoveAck,
  onSuppress,
  onUnsuppress,
  onChangeSeverity,
  onDone,
}: {
  count: number;
  pending: boolean;
  onConfirm: (message: string | undefined) => void;
  onRemoveAck: (message: string | undefined) => void;
  onSuppress: (message: string | undefined, suppressUntil: number) => void;
  onUnsuppress: (message: string | undefined) => void;
  onChangeSeverity: (severity: Severity, message: string | undefined) => void;
  onDone: () => void;
}) {
  const t = useT();
  const [comment, setComment] = useState("");
  const [severityOpen, setSeverityOpen] = useState(false);
  const severityRef = useRef<HTMLDivElement>(null);

  const message = comment.trim().length > 0 ? comment.trim() : undefined;
  const hasSelection = count > 0;

  useEffect(() => {
    if (!severityOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (!severityRef.current?.contains(e.target as Node)) setSeverityOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setSeverityOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [severityOpen]);

  function runAndReset(action: (message: string | undefined) => void) {
    action(message);
    setComment("");
  }

  return (
    <div className="flex flex-1 flex-wrap items-center gap-2 min-[700px]:flex-nowrap min-[700px]:justify-end">
      <span className="whitespace-nowrap font-mono text-xs font-semibold text-ink">
        {t("problems.selectMode.selectedCount", count)}
      </span>
      <input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t("problems.selectMode.commentPlaceholder")}
        className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink outline-none focus-visible:border-accent min-[700px]:max-w-[240px]"
      />
      <button
        type="button"
        disabled={pending || !hasSelection}
        onClick={() => runAndReset(onConfirm)}
        className="whitespace-nowrap rounded-md border border-accent/40 bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent disabled:opacity-40"
      >
        {t("problems.selectMode.confirm")}
      </button>
      <button
        type="button"
        disabled={pending || !hasSelection}
        onClick={() => runAndReset(onRemoveAck)}
        className="whitespace-nowrap rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2 disabled:opacity-40"
      >
        {t("problems.selectMode.removeAck")}
      </button>
      <SuppressButton
        pending={pending || !hasSelection}
        onSuppress={(suppressUntil) => {
          onSuppress(message, suppressUntil);
          setComment("");
        }}
      />
      <button
        type="button"
        disabled={pending || !hasSelection}
        onClick={() => runAndReset(onUnsuppress)}
        className="whitespace-nowrap rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2 disabled:opacity-40"
      >
        {t("problems.selectMode.unsuppress")}
      </button>
      <div ref={severityRef} className="relative inline-flex">
        <button
          type="button"
          disabled={pending || !hasSelection}
          aria-haspopup="menu"
          aria-expanded={severityOpen}
          onClick={() => setSeverityOpen((v) => !v)}
          className="whitespace-nowrap rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2 disabled:opacity-40"
        >
          {t("problems.selectMode.severity")}
        </button>
        {severityOpen && (
          <div
            role="menu"
            className="absolute right-0 top-full z-30 mt-1 w-max max-w-[280px] rounded-md border border-line bg-surface p-2 shadow-lg"
          >
            <SeverityPills
              disabled={pending || !hasSelection}
              onSelect={(severity) => {
                setSeverityOpen(false);
                onChangeSeverity(severity, message);
                setComment("");
              }}
            />
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={onDone}
        className="whitespace-nowrap rounded-md border border-line px-2.5 py-1 text-xs text-ink-muted"
      >
        {t("problems.selectMode.done")}
      </button>
    </div>
  );
}
