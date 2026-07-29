import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { ZabbixItem } from "@auzui/zabbix-client";
import {
  currentFieldDraft,
  parseMetricQuery,
  removeTokenAt,
  replaceFieldToken,
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

/**
 * Query-Bar (Entwurf 2, PLAN.md): a single text input that doubles as a
 * token filter language (host:/group:/component:/key:/unit: + free text).
 * Committed tokens are shown as removable chips above the input; the input
 * itself keeps holding the raw editable string (simpler and more powerful
 * than hiding recognized substrings — power users can also hand-edit tokens
 * directly, same as GitHub's issue search).
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
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo(() => parseMetricQuery(value), [value]);
  const draft = useMemo(() => currentFieldDraft(value), [value]);
  const fieldNameSuggestions = useMemo(() => (draft ? [] : suggestFieldNames(value)), [value, draft]);

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

  const open = focused && rows.length > 0;

  function replaceLastWord(replacement: string): string {
    const trimmed = value.trimEnd();
    const lastSpace = trimmed.lastIndexOf(" ");
    const head = lastSpace >= 0 ? trimmed.slice(0, lastSpace + 1) : "";
    return `${head}${replacement} `;
  }

  function selectRow(row: SuggestionRow | undefined) {
    if (!row) return;
    if (row.kind === "field") {
      onChange(replaceLastWord(`${row.field}:`));
    } else if (row.kind === "value") {
      onChange(`${replaceFieldToken(value, row.field, row.value)} `);
    } else {
      onAddItem(row.item);
    }
    setHighlighted(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setFocused(false);
      inputRef.current?.blur();
    } else if (e.key === "ArrowDown") {
      if (rows.length === 0) return;
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      if (rows.length === 0) return;
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (rows.length > 0) {
        e.preventDefault();
        selectRow(rows[highlighted]);
      }
    }
  }

  function removeToken(index: number) {
    onChange(removeTokenAt(value, index));
  }

  return (
    <div className="relative rounded-lg border border-line bg-surface p-2.5">
      {parsed.tokens.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {parsed.tokens.map((tok, i) => (
            <span
              key={`${tok.field}-${tok.value}-${i}`}
              className="inline-flex items-center gap-1 rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10.5px] text-accent"
            >
              {tok.field}:{tok.value}
              <button
                type="button"
                onClick={() => removeToken(i)}
                className="text-accent/70 hover:text-accent"
                aria-label={t("metrics.removeToken", tok.field, tok.value)}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setHighlighted(0);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 120)}
        onKeyDown={handleKeyDown}
        placeholder={t("metrics.queryPlaceholder")}
        aria-label={t("metrics.queryAria")}
        className="w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-[12.5px] text-ink outline-none"
      />

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-lg border border-line bg-surface shadow-lg">
          {fieldNameSuggestions.length > 0 && (
            <SuggestionGroup label={t("metrics.autocomplete.fields")}>
              {fieldNameSuggestions.map((field, i) => {
                const idx = i;
                return (
                  <SuggestionRowButton key={field} active={idx === highlighted} onClick={() => selectRow(rows[idx])}>
                    <span className="font-mono">{field}:</span>
                  </SuggestionRowButton>
                );
              })}
            </SuggestionGroup>
          )}

          {draft && valueSuggestions.length > 0 && (
            <SuggestionGroup label={t(`metrics.autocomplete.${autocompleteGroupKey(draft.field)}`)}>
              {valueSuggestions.map((row, i) => {
                const idx = fieldNameSuggestions.length + i;
                if (row.kind !== "value") return null;
                return (
                  <SuggestionRowButton key={`${row.field}-${row.value}`} active={idx === highlighted} onClick={() => selectRow(rows[idx])}>
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
                  <SuggestionRowButton key={item.itemid} active={idx === highlighted} onClick={() => selectRow(rows[idx])}>
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
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] ${
        active ? "bg-accent-soft text-accent" : "text-ink-2 hover:bg-surface-2"
      }`}
    >
      {children}
    </button>
  );
}
