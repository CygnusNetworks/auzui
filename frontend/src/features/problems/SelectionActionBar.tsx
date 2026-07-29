import { useState } from "react";
import { useT } from "../../lib/i18n";

/**
 * In-toolbar action bar for the Problems "Auswahlmodus" (select mode). Unlike
 * the previous floating BulkActionBar, this lives at the top of the list so it
 * stays visible next to the filters. The optional comment is sent as the
 * message on all three actions (ack / un-ack / suppress) — event.acknowledge
 * accepts a batch of eventids in a single mutation (see use-acknowledge.ts).
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
  onDone,
}: {
  count: number;
  pending: boolean;
  onConfirm: (message: string | undefined) => void;
  onRemoveAck: (message: string | undefined) => void;
  onSuppress: (message: string | undefined) => void;
  onDone: () => void;
}) {
  const t = useT();
  const [comment, setComment] = useState("");

  const message = comment.trim().length > 0 ? comment.trim() : undefined;
  const hasSelection = count > 0;

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
      <button
        type="button"
        disabled={pending || !hasSelection}
        onClick={() => runAndReset(onSuppress)}
        className="whitespace-nowrap rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2 disabled:opacity-40"
      >
        {t("problems.selectMode.suppress")}
      </button>
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
