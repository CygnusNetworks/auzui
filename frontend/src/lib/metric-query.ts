/**
 * Query-Bar (Entwurf 2, PLAN.md) — parses/serializes the token-based metrics
 * query string ("host:docker-virt6 eth0") into structured filter tokens plus
 * leftover free text. Pure functions only, no React/Zabbix here — the
 * QueryBar component and useMetricsSearch build on top of these.
 */

export const METRIC_QUERY_FIELDS = ["host", "group", "component", "key", "unit"] as const;
export type MetricQueryField = (typeof METRIC_QUERY_FIELDS)[number];

export interface MetricQueryToken {
  field: MetricQueryField;
  value: string;
}

export interface ParsedMetricQuery {
  tokens: MetricQueryToken[];
  text: string;
}

function isMetricQueryField(value: string): value is MetricQueryField {
  return (METRIC_QUERY_FIELDS as readonly string[]).includes(value);
}

// Matches "field:value" or "field:"quoted value"" — value is either a quoted
// span (spaces allowed) or a run of non-space characters.
const TOKEN_RE = /(host|group|component|key|unit):(?:"([^"]*)"|(\S+))/g;

/**
 * Splits the raw query bar text into recognized filter tokens and the
 * remaining free text (used for item.get's name/key_ search).
 * `parseMetricQuery('host:docker-virt6 eth0')` →
 * `{ tokens: [{field:"host", value:"docker-virt6"}], text: "eth0" }`.
 */
export function parseMetricQuery(input: string): ParsedMetricQuery {
  const tokens: MetricQueryToken[] = [];
  const textParts: string[] = [];
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(input))) {
    const before = input.slice(lastIndex, match.index).trim();
    if (before) textParts.push(before);
    const field = match[1]!;
    if (isMetricQueryField(field)) {
      const value = match[2] !== undefined ? match[2] : (match[3] ?? "");
      if (value) tokens.push({ field, value });
    }
    lastIndex = TOKEN_RE.lastIndex;
  }
  const rest = input.slice(lastIndex).trim();
  if (rest) textParts.push(rest);
  return { tokens, text: textParts.join(" ").trim() };
}

function quoteIfNeeded(value: string): string {
  return /\s/.test(value) ? `"${value}"` : value;
}

/** Inverse of parseMetricQuery — reconstructs a query bar string from tokens + free text. */
export function serializeMetricQuery(query: ParsedMetricQuery): string {
  const parts = query.tokens.map((t) => `${t.field}:${quoteIfNeeded(t.value)}`);
  const text = query.text.trim();
  if (text) parts.push(text);
  return parts.join(" ");
}

/** Removes the token at `index` (as returned by parseMetricQuery(input).tokens) from the raw string. */
export function removeTokenAt(input: string, index: number): string {
  const parsed = parseMetricQuery(input);
  return serializeMetricQuery({ tokens: parsed.tokens.filter((_, i) => i !== index), text: parsed.text });
}

/** Replaces all tokens of `field` with a single new value (host/group/component/unit are single-select facets). */
export function replaceFieldToken(input: string, field: MetricQueryField, value: string): string {
  const parsed = parseMetricQuery(input);
  const tokens = parsed.tokens.filter((t) => t.field !== field);
  tokens.push({ field, value });
  return serializeMetricQuery({ tokens, text: parsed.text });
}

/** Appends a token, replacing an existing (field,value) duplicate — used for repeatable fields like key:. */
export function addToken(input: string, field: MetricQueryField, value: string): string {
  const parsed = parseMetricQuery(input);
  const tokens = parsed.tokens.filter((t) => !(t.field === field && t.value === value));
  tokens.push({ field, value });
  return serializeMetricQuery({ tokens, text: parsed.text });
}

/** The last whitespace-delimited "word" in the raw input — used to drive autocomplete off the caret-adjacent token. */
function lastWord(input: string): string {
  const trimmed = input.trimEnd();
  const lastSpace = trimmed.lastIndexOf(" ");
  return trimmed.slice(lastSpace + 1);
}

/**
 * Field-name suggestions (e.g. typing "comp" suggests "component:") — only
 * fires when the last word has no colon yet.
 */
export function suggestFieldNames(input: string): MetricQueryField[] {
  const word = lastWord(input).toLowerCase();
  if (!word || word.includes(":")) return [];
  return METRIC_QUERY_FIELDS.filter((f) => f.startsWith(word));
}

/** The field+partial-value currently being typed (e.g. "host:doc" → {field:"host", value:"doc"}), or null. */
export function currentFieldDraft(input: string): { field: MetricQueryField; value: string } | null {
  const word = lastWord(input);
  const match = /^(host|group|component|key|unit):(.*)$/.exec(word);
  if (!match) return null;
  const field = match[1]!;
  if (!isMetricQueryField(field)) return null;
  return { field, value: match[2] ?? "" };
}
