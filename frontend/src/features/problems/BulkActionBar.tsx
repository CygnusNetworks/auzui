import { useState } from "react";
import { useT } from "../../lib/i18n";

/**
 * Sticky bulk-action bar for the multi-select checkboxes in LaneSection.
 * event.acknowledge accepts multiple eventids in one call, so ack/unack for
 * the whole selection is a single mutation (see use-acknowledge.ts).
 */
export function BulkActionBar({
  selectedIds,
  pending,
  onAck,
  onUnack,
  onClear,
}: {
  selectedIds: ReadonlySet<string>;
  pending: boolean;
  onAck: (message: string | undefined) => void;
  onUnack: (message: string | undefined) => void;
  onClear: () => void;
}) {
  const t = useT();
  const [comment, setComment] = useState("");

  if (selectedIds.size === 0) return null;

  const message = comment.trim().length > 0 ? comment.trim() : undefined;

  function runAndReset(action: (message: string | undefined) => void) {
    action(message);
    setComment("");
  }

  return (
    <div className="sticky bottom-3 z-10 mx-auto mt-3 flex max-w-[900px] flex-wrap items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2.5 shadow-lg">
      <span className="font-mono text-xs font-semibold text-ink">
        {t("problems.bulkBar.selectedCount", selectedIds.size)}
      </span>
      <input
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t("problems.bulkBar.commentPlaceholder")}
        className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink outline-none focus-visible:border-accent"
      />
      <button
        type="button"
        disabled={pending}
        onClick={() => runAndReset(onAck)}
        className="rounded-md border border-accent/40 bg-accent-soft px-2.5 py-1 text-xs font-semibold text-accent disabled:opacity-40"
      >
        {t("problems.bulkBar.acknowledge")}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => runAndReset(onUnack)}
        className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-xs text-ink-2 disabled:opacity-40"
      >
        {t("problems.bulkBar.unacknowledge")}
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={onClear}
        className="rounded-md border border-line px-2.5 py-1 text-xs text-ink-muted disabled:opacity-40"
      >
        {t("problems.bulkBar.clearSelection")}
      </button>
    </div>
  );
}
