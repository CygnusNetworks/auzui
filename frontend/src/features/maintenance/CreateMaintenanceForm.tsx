import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import { buildMaintenancePayload } from "../../lib/maintenance";
import { useCreateMaintenance } from "./use-maintenance-mutations";

interface Option {
  id: string;
  label: string;
}

const DURATION_PRESETS: { label: string; hours: number }[] = [
  { label: "1 h", hours: 1 },
  { label: "4 h", hours: 4 },
  { label: "8 h", hours: 8 },
  { label: "1 Tag", hours: 24 },
  { label: "1 Woche", hours: 24 * 7 },
];

function nowLocalDateTime(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function CreateMaintenanceForm() {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState(nowLocalDateTime());
  const [durationHours, setDurationHours] = useState(1);
  const [customHours, setCustomHours] = useState("");
  const [withDataCollection, setWithDataCollection] = useState(true);
  const [hosts, setHosts] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [hostQuery, setHostQuery] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [formError, setFormError] = useState<string | undefined>();

  const createMutation = useCreateMaintenance();

  const allHostsQuery = useQuery({
    queryKey: ["all-hosts"],
    queryFn: () => zabbixApi.hostGet({ output: ["hostid", "host", "name"], sortfield: "name" }),
    staleTime: 5 * 60_000,
  });
  const allGroupsQuery = useQuery({
    queryKey: ["all-hostgroups"],
    queryFn: () => zabbixApi.hostgroupGet({ output: "extend", sortfield: "name" }),
    staleTime: 5 * 60_000,
  });

  const hostOptions: Option[] = useMemo(
    () => (allHostsQuery.data ?? []).map((h) => ({ id: h.hostid, label: h.name || h.host })),
    [allHostsQuery.data],
  );
  const groupOptions: Option[] = useMemo(
    () => (allGroupsQuery.data ?? []).map((g) => ({ id: g.groupid, label: g.name })),
    [allGroupsQuery.data],
  );

  const hostMatches = useMemo(() => filterOptions(hostOptions, hostQuery, hosts), [
    hostOptions,
    hostQuery,
    hosts,
  ]);
  const groupMatches = useMemo(() => filterOptions(groupOptions, groupQuery, groups), [
    groupOptions,
    groupQuery,
    groups,
  ]);

  function reset() {
    setName("");
    setDescription("");
    setStart(nowLocalDateTime());
    setDurationHours(1);
    setCustomHours("");
    setWithDataCollection(true);
    setHosts([]);
    setGroups([]);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(undefined);
    const startSeconds = Math.floor(new Date(start).getTime() / 1000);
    const hoursValue = customHours ? Number(customHours) : durationHours;
    let payload;
    try {
      payload = buildMaintenancePayload({
        name,
        description,
        hostids: hosts.map((h) => h.id),
        groupids: groups.map((g) => g.id),
        startSeconds,
        durationSeconds: Math.round(hoursValue * 3600),
        withDataCollection,
      });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Ungültige Eingabe.");
      return;
    }
    createMutation.mutate(payload, {
      onSuccess: reset,
      onError: (err) => setFormError(err instanceof Error ? err.message : "Unbekannter Fehler"),
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-3.5">
      <h2 className="text-[13px] font-semibold text-ink">Wartungsfenster anlegen</h2>

      <label className="flex flex-col gap-1 text-xs text-ink-2">
        Name
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-2">
        Beschreibung
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="resize-none rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
        />
      </label>

      <ComboboxField
        label="Hosts"
        query={hostQuery}
        onQueryChange={setHostQuery}
        matches={hostMatches}
        selected={hosts}
        onSelect={(o) => {
          setHosts([...hosts, o]);
          setHostQuery("");
        }}
        onRemove={(id) => setHosts(hosts.filter((h) => h.id !== id))}
      />

      <ComboboxField
        label="Hostgruppen"
        query={groupQuery}
        onQueryChange={setGroupQuery}
        matches={groupMatches}
        selected={groups}
        onSelect={(o) => {
          setGroups([...groups, o]);
          setGroupQuery("");
        }}
        onRemove={(id) => setGroups(groups.filter((g) => g.id !== id))}
      />

      <label className="flex flex-col gap-1 text-xs text-ink-2">
        Start
        <input
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          required
          className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
        />
      </label>

      <div className="flex flex-col gap-1.5 text-xs text-ink-2">
        Dauer
        <div className="flex flex-wrap gap-1.5">
          {DURATION_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                setDurationHours(preset.hours);
                setCustomHours("");
              }}
              className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${
                !customHours && durationHours === preset.hours
                  ? "border-accent/50 bg-accent-soft font-semibold text-accent"
                  : "border-line text-ink-2"
              }`}
            >
              {preset.label}
            </button>
          ))}
          <input
            type="number"
            min={0.5}
            step={0.5}
            placeholder="eigene (h)"
            value={customHours}
            onChange={(e) => setCustomHours(e.target.value)}
            className="w-24 rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-ink-2">
        <input
          type="checkbox"
          checked={withDataCollection}
          onChange={(e) => setWithDataCollection(e.target.checked)}
        />
        Daten weiter erfassen
      </label>

      {formError && <div className="text-xs text-sev-high">{formError}</div>}

      <button
        type="submit"
        disabled={createMutation.isPending}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-50"
      >
        {createMutation.isPending ? "Wird angelegt…" : "Wartungsfenster anlegen"}
      </button>
    </form>
  );
}

function filterOptions(options: Option[], query: string, selected: Option[]): Option[] {
  const selectedIds = new Set(selected.map((s) => s.id));
  const q = query.trim().toLowerCase();
  return options
    .filter((o) => !selectedIds.has(o.id))
    .filter((o) => (q ? o.label.toLowerCase().includes(q) : true))
    .slice(0, 8);
}

function ComboboxField({
  label,
  query,
  onQueryChange,
  matches,
  selected,
  onSelect,
  onRemove,
}: {
  label: string;
  query: string;
  onQueryChange: (v: string) => void;
  matches: Option[];
  selected: Option[];
  onSelect: (o: Option) => void;
  onRemove: (id: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <div className="flex flex-col gap-1 text-xs text-ink-2">
      {label}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder="tippen zum Filtern…"
          className="w-full rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
        />
        {focused && matches.length > 0 && (
          <ul className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-line bg-surface shadow-md">
            {matches.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  onMouseDown={() => onSelect(o)}
                  className="block w-full px-2.5 py-1.5 text-left text-[12.5px] text-ink hover:bg-surface-2"
                >
                  {o.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((o) => (
            <span
              key={o.id}
              className="inline-flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[10.5px] text-ink-2"
            >
              {o.label}
              <button
                type="button"
                onClick={() => onRemove(o.id)}
                className="text-ink-muted"
                aria-label={`${o.label} entfernen`}
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
