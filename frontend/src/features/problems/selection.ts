/**
 * Pure selection helpers for the Problems "Auswahlmodus" (select mode).
 * Kept free of React so the toggle / select-all / tri-state logic is unit
 * testable in isolation (see __tests__/selection.test.ts).
 */

/** Toggle a single eventid in the selection, returning a new set. */
export function toggleSelection(
  selected: ReadonlySet<string>,
  eventid: string,
): Set<string> {
  const next = new Set(selected);
  if (next.has(eventid)) next.delete(eventid);
  else next.add(eventid);
  return next;
}

/**
 * Add (checked) or remove (unchecked) every given eventid — used by the lane
 * header's select-all toggle. Returns a new set.
 */
export function setLaneSelection(
  selected: ReadonlySet<string>,
  eventids: readonly string[],
  checked: boolean,
): Set<string> {
  const next = new Set(selected);
  for (const id of eventids) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return next;
}

export type TriState = "all" | "some" | "none";

/**
 * Tri-state of a lane's select-all control: "all" if every eventid is
 * selected, "none" if none are, "some" otherwise. An empty lane is "none".
 */
export function laneTriState(
  selected: ReadonlySet<string>,
  eventids: readonly string[],
): TriState {
  if (eventids.length === 0) return "none";
  let selectedCount = 0;
  for (const id of eventids) {
    if (selected.has(id)) selectedCount += 1;
  }
  if (selectedCount === 0) return "none";
  if (selectedCount === eventids.length) return "all";
  return "some";
}

/** Keep only ids that are still visible (e.g. after ack/filter drops rows). */
export function retainVisible(
  selected: ReadonlySet<string>,
  visibleIds: Iterable<string>,
): Set<string> {
  const visible = new Set(visibleIds);
  return new Set([...selected].filter((id) => visible.has(id)));
}
