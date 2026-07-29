import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ZabbixItem } from "@auzui/zabbix-client";
import {
  addToken,
  currentFieldDraft,
  parseMetricQuery,
  removeTokenAt,
  replaceFieldToken,
  serializeMetricQuery,
  suggestFieldNames,
  type MetricQueryField,
} from "../../lib/metric-query";
import { deriveComponentFacet, deriveUnitFacet } from "../../lib/metrics-facets";
import { useGroupSuggestions, useHostSuggestions } from "./use-metrics";
import { useT } from "../../lib/i18n";

const MAX_ITEM_SUGGESTIONS = 8;

type SuggestionRow =
  | { kind: "field"; field: MetricQueryField }
  | { kind: "value"; field: MetricQueryField; value: string; label: string }
  | { kind: "item"; item: ZabbixItem };

/** The free text before the word currently under the caret (the composing token). */
function leadingFreeText(input: string): string {
  const trimmed = input.replace(/\s+$/, "");
  const lastSpace = trimmed.lastIndexOf(" ");
  return lastSpace >= 0 ? trimmed.slice(0, lastSpace).trim() : "";
}

/** Replaces the last whitespace-delimited word of `input` with `replacement`. */
function replaceLastWord(input: string, replacement: string): string {
  const trimmed = input.replace(/\s+$/, "");
  const lastSpace = trimmed.lastIndexOf(" ");
  const head = lastSpace >= 0 ? trimmed.slice(0, lastSpace + 1) : "";
  return `${head}${replacement}`;
}

/**
 * Query-Bar (Entwurf 2, PLAN.md): a single field that doubles as a token filter
 * language (host:/group:/component:/key:/unit: + free text). Mirrors tiqora's
 * SmartSearchBar: committed tokens live ONLY as removable chips inside the
 * field — they never sit in the editable text (which used to overlay a raw
 * string under the chips and made editing confusing). The input holds just the
 * free text plus whatever token the user is currently composing; on commit the
 * token becomes a chip and the input keeps only the free text. The parent still
 * owns the full serialized query (`value` ⇄ URL ?q=), so persistence is
 * unchanged — we only re-split where the editable boundary sits.
 */
export function QueryBar({
  value,
  onChange,
  items,
  onAddItem,
  selectedIds,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Current search results — source for component:/unit: value suggestions and the inline item preview. */
  items: ZabbixItem[];
  onAddItem: (item: ZabbixItem) => void;
  selectedIds: Set<string>;
}) {
  const t = useT();
  const [focused, setFocused] = useState(false);
  // Escape hides the dropdown without dropping focus or the typed text.
  const [dropdownDismissed, setDropdownDismissed] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Committed part (chips + free text) comes from the parent's serialized query.
  const committed = useMemo(() => parseMetricQuery(value), [value]);
  // Editable buffer: free text + the token currently being composed.
  const [input, setInput] = useState(committed.text);

  // Re-sync the editable buffer when the query changes from the outside (URL
  // nav, chip removal), but never while a token is mid-composition — that would
  // wipe the "host:doc…" the user is typing.
  // Keyed on `value` only (an external change): re-sync the buffer from the URL
  // query, but never while composing a token. Intentionally does NOT depend on
  // `input` — reacting to our own keystrokes here would clobber the buffer with
  // the not-yet-propagated parent value.
  const inputRefLatest = useRef(input);
  inputRefLatest.current = input;
  useEffect(() => {
    if (!currentFieldDraft(inputRefLatest.current)) setInput(parseMetricQuery(value).text);
  }, [value]);

  const draft = useMemo(() => currentFieldDraft(input), [input]);
  const fieldNameSuggestions = useMemo(() => (draft ? [] : suggestFieldNames(input)), [input, draft]);

  const hostSuggestQuery = useHostSuggestions(draft?.field === "host" ? draft.value : "");
  const groupSuggestQuery = useGroupSuggestions(draft?.field === "group" ? draft.value : "");
  const componentFacet = useMemo(() => deriveComponentFacet(items), [items]);
  const unitFacet = useMemo(() => deriveUnitFacet(items), [items]);

  const valueSuggestions: SuggestionRow[] = useMemo(() => {
    if (!draft) return [];
    const prefix = draft.value.toLowerCase();
    if (draft.field === "host") {
      return (hostSuggestQuery.data ?? []).map((h) => ({
        kind: "value" as const,
        field: "host" as const,
        value: h.name || h.host,
        label: h.name && h.name !== h.host ? `${h.name} (${h.host})` : h.host,
      }));
    }
    if (draft.field === "group") {
      return (groupSuggestQuery.data ?? []).map((g) => ({
        kind: "value" as const,
        field: "group" as const,
        value: g.name,
        label: g.name,
      }));
    }
    if (draft.field === "component") {
      return componentFacet
        .filter((f) => f.value.toLowerCase().includes(prefix))
        .map((f) => ({ kind: "value" as const, field: "component" as const, value: f.value, label: f.value }));
    }
    if (draft.field === "unit") {
      return unitFacet
        .filter((f) => f.value.toLowerCase().includes(prefix))
        .map((f) => ({ kind: "value" as const, field: "unit" as const, value: f.value, label: f.value }));
    }
    return [];
  }, [draft, hostSuggestQuery.data, groupSuggestQuery.data, componentFacet, unitFacet]);

  const itemSuggestions: SuggestionRow[] = useMemo(() => {
    if (draft) return [];
    return items.slice(0, MAX_ITEM_SUGGESTIONS).map((item) => ({ kind: "item" as const, item }));
  }, [draft, items]);

  const rows: SuggestionRow[] = useMemo(
    () => [
      ...fieldNameSuggestions.map((field) => ({ kind: "field" as const, field })),
      ...valueSuggestions,
      ...itemSuggestions,
    ],
    [fieldNameSuggestions, valueSuggestions, itemSuggestions],
  );

  const open = focused && !dropdownDismissed && rows.length > 0;

  /** Push a new editable buffer up: committed tokens + (free text | leading text while composing). */
  function updateInput(next: string) {
    setInput(next);
    setHighlighted(0);
    setDropdownDismissed(false);
    const nextDraft = currentFieldDraft(next);
    const text = nextDraft ? leadingFreeText(next) : next.trim();
    onChange(serializeMetricQuery({ tokens: committed.tokens, text }));
  }

  /** Commit a value token → chip, drop the composing draft from the input, keep typing. */
  function commitToken(field: MetricQueryField, tokenValue: string) {
    const base = serializeMetricQuery({ tokens: committed.tokens, text: leadingFreeText(input) });
    const next = field === "key" ? addToken(base, field, tokenValue) : replaceFieldToken(base, field, tokenValue);
    onChange(next);
    const freeText = parseMetricQuery(next).text;
    setInput(freeText ? `${freeText} ` : "");
    setHighlighted(0);
    setDropdownDismissed(false);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function selectRow(row: SuggestionRow | undefined) {
    if (!row) return;
    if (row.kind === "field") {
      // Field-name pick just seeds "field:" and keeps composing (no chip yet).
      const next = replaceLastWord(input, `${row.field}:`);
      updateInput(next);
      requestAnimationFrame(() => inputRef.current?.focus());
    } else if (row.kind === "value") {
      commitToken(row.field, row.value);
    } else {
      onAddItem(row.item);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }

  function removeToken(index: number) {
    onChange(removeTokenAt(value, index));
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setDropdownDismissed(true);
      }
    } else if (e.key === "ArrowDown") {
      if (rows.length === 0) return;
      e.preventDefault();
      setDropdownDismissed(false);
      setHighlighted((h) => Math.min(h + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      if (rows.length === 0) return;
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" || e.key === "Tab") {
      // Enter/Tab commit the highlighted suggestion (Tab only when the dropdown
      // is open, so tabbing out of an empty field still moves focus normally).
      if (open) {
        e.preventDefault();
        selectRow(rows[highlighted]);
      }
    } else if (e.key === "Backspace" && input === "" && committed.tokens.length > 0) {
      // Backspace at the start of an empty input removes the last chip.
      e.preventDefault();
      removeToken(committed.tokens.length - 1);
    }
  }

  return (
    <div className="relative">
      <div
        className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-2 focus-within:border-accent/60"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) inputRef.current?.focus();
        }}
      >
        {committed.tokens.map((tok, i) => (
          <span
            key={`${tok.field}-${tok.value}-${i}`}
            className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10.5px] text-accent"
          >
            {tok.field}:{tok.value}
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                removeToken(i);
              }}
              className="text-accent/70 hover:text-accent"
              aria-label={t("metrics.removeToken", tok.field, tok.value)}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => updateInput(e.target.value)}
          onFocus={() => {
            setFocused(true);
            setDropdownDismissed(false);
          }}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={handleKeyDown}
          placeholder={committed.tokens.length > 0 ? "" : t("metrics.queryPlaceholder")}
          aria-label={t("metrics.queryAria")}
          autoComplete="off"
          spellCheck={false}
          className="min-w-[8rem] flex-1 bg-transparent font-mono text-[12.5px] text-ink outline-none placeholder:text-ink-muted"
        />
      </div>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-line bg-surface shadow-lg">
          {fieldNameSuggestions.length > 0 && (
            <SuggestionGroup label={t("metrics.autocomplete.fields")}>
              {fieldNameSuggestions.map((field, i) => (
                <SuggestionRowButton key={field} active={i === highlighted} onSelect={() => selectRow(rows[i])}>
                  <span className="font-mono">{field}:</span>
                </SuggestionRowButton>
              ))}
            </SuggestionGroup>
          )}

          {draft && valueSuggestions.length > 0 && (
            <SuggestionGroup label={t(`metrics.autocomplete.${autocompleteGroupKey(draft.field)}`)}>
              {valueSuggestions.map((row, i) => {
                const idx = fieldNameSuggestions.length + i;
                if (row.kind !== "value") return null;
                return (
                  <SuggestionRowButton
                    key={`${row.field}-${row.value}`}
                    active={idx === highlighted}
                    onSelect={() => selectRow(rows[idx])}
                  >
                    {row.label}
                  </SuggestionRowButton>
                );
              })}
            </SuggestionGroup>
          )}

          {draft && valueSuggestions.length === 0 && (
            <div className="px-3 py-2 text-[12px] text-ink-2">{t("metrics.autocomplete.noResults")}</div>
          )}

          {!draft && itemSuggestions.length > 0 && (
            <SuggestionGroup label={t("metrics.autocomplete.items")}>
              {itemSuggestions.map((row, i) => {
                const idx = fieldNameSuggestions.length + valueSuggestions.length + i;
                if (row.kind !== "item") return null;
                const item = row.item;
                const hostName = item.hosts?.[0]?.name ?? item.hosts?.[0]?.host ?? "";
                const added = selectedIds.has(item.itemid);
                return (
                  <SuggestionRowButton key={item.itemid} active={idx === highlighted} onSelect={() => selectRow(rows[idx])}>
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate">{item.name}</span>
                      <span className="truncate font-mono text-[10.5px] text-ink-muted">{hostName}</span>
                    </span>
                    {item.units && <span className="font-mono text-[10.5px] text-ink-muted">{item.units}</span>}
                    {added && <span className="text-accent">✓</span>}
                  </SuggestionRowButton>
                );
              })}
            </SuggestionGroup>
          )}
        </div>
      )}
    </div>
  );
}

function autocompleteGroupKey(field: MetricQueryField): "hosts" | "groups" | "components" | "units" | "items" {
  if (field === "host") return "hosts";
  if (field === "group") return "groups";
  if (field === "component") return "components";
  return "units";
}

function SuggestionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-1">
      <div className="px-3 pb-0.5 pt-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-muted">{label}</div>
      {children}
    </div>
  );
}

function SuggestionRowButton({
  active,
  onSelect,
  children,
}: {
  active: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      // mousedown (not click) fires before the input's blur, so committing a
      // suggestion by mouse keeps focus in the input for the next token.
      onMouseDown={(e) => {
        e.preventDefault();
        onSelect();
      }}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] ${
        active ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}
