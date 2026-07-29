import { useMemo, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { zabbixApi } from "../../lib/auth/store";
import {
  buildMaintenancePayload,
  dayOfWeekBit,
  monthLabels,
  weekdayFullLabels,
  weekdayLabels,
  weekdayOccurrenceLabels,
  type MaintenanceRecurrence,
} from "../../lib/maintenance";
import { useCreateMaintenance } from "./use-maintenance-mutations";
import { useLocale, useT } from "../../lib/i18n";

interface Option {
  id: string;
  label: string;
}

function nowLocalDateTime(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function CreateMaintenanceForm() {
  const t = useT();
  const { locale } = useLocale();

  const RECURRENCE_OPTIONS: { value: MaintenanceRecurrence; label: string }[] = [
    { value: "once", label: t("maintenance.form.recurrence.once") },
    { value: "daily", label: t("maintenance.form.recurrence.daily") },
    { value: "weekly", label: t("maintenance.form.recurrence.weekly") },
    { value: "monthlyDay", label: t("maintenance.form.recurrence.monthlyDay") },
    { value: "monthlyWeekday", label: t("maintenance.form.recurrence.monthlyWeekday") },
    { value: "yearly", label: t("maintenance.form.recurrence.yearly") },
  ];

  const DURATION_PRESETS: { label: string; minutes: number }[] = [
    { label: "5 min", minutes: 5 },
    { label: "10 min", minutes: 10 },
    { label: "15 min", minutes: 15 },
    { label: "30 min", minutes: 30 },
    { label: "1 h", minutes: 60 },
    { label: "4 h", minutes: 4 * 60 },
    { label: "8 h", minutes: 8 * 60 },
    { label: t("maintenance.form.durationDay"), minutes: 24 * 60 },
    { label: t("maintenance.form.durationWeek"), minutes: 7 * 24 * 60 },
  ];

  const [recurrence, setRecurrence] = useState<MaintenanceRecurrence>("once");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [start, setStart] = useState(nowLocalDateTime());
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [customDuration, setCustomDuration] = useState("");
  const [customDurationUnit, setCustomDurationUnit] = useState<"minutes" | "hours">("hours");
  const [withDataCollection, setWithDataCollection] = useState(true);
  const [hosts, setHosts] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [hostQuery, setHostQuery] = useState("");
  const [groupQuery, setGroupQuery] = useState("");
  const [formError, setFormError] = useState<string | undefined>();
  const [weekdays, setWeekdays] = useState<Set<number>>(new Set());
  const [recurringTime, setRecurringTime] = useState("09:00");
  const [everyDays, setEveryDays] = useState("1");
  const [monthDay, setMonthDay] = useState("1");
  const [weekdayIndex, setWeekdayIndex] = useState(0);
  const [weekdayOccurrence, setWeekdayOccurrence] = useState(1);
  const [yearlyMonth, setYearlyMonth] = useState(1);

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
    setRecurrence("once");
    setName("");
    setDescription("");
    setStart(nowLocalDateTime());
    setDurationMinutes(60);
    setCustomDuration("");
    setCustomDurationUnit("hours");
    setWithDataCollection(true);
    setHosts([]);
    setGroups([]);
    setWeekdays(new Set());
    setRecurringTime("09:00");
    setEveryDays("1");
    setMonthDay("1");
    setWeekdayIndex(0);
    setWeekdayOccurrence(1);
    setYearlyMonth(1);
  }

  function toggleWeekday(index: number) {
    setWeekdays((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    setFormError(undefined);
    const startSeconds = Math.floor(new Date(start).getTime() / 1000);
    const durationSeconds = customDuration
      ? Math.round(Number(customDuration) * (customDurationUnit === "hours" ? 3600 : 60))
      : durationMinutes * 60;
    const [hh, mm] = recurringTime.split(":").map(Number);
    const startTimeSeconds = (hh || 0) * 3600 + (mm || 0) * 60;

    const common = {
      name,
      description,
      hostids: hosts.map((h) => h.id),
      groupids: groups.map((g) => g.id),
      startSeconds,
      durationSeconds,
      withDataCollection,
    };

    let payload;
    try {
      switch (recurrence) {
        case "daily":
          payload = buildMaintenancePayload(
            {
              ...common,
              recurrence: "daily",
              startTimeSeconds,
              everyDays: Number(everyDays) || 1,
            },
            locale,
          );
          break;
        case "weekly": {
          const dayofweek = [...weekdays].reduce((mask, i) => mask | dayOfWeekBit(i), 0);
          payload = buildMaintenancePayload(
            {
              ...common,
              recurrence: "weekly",
              dayofweek,
              startTimeSeconds,
            },
            locale,
          );
          break;
        }
        case "monthlyDay":
          payload = buildMaintenancePayload(
            {
              ...common,
              recurrence: "monthlyDay",
              monthDay: Number(monthDay),
              startTimeSeconds,
            },
            locale,
          );
          break;
        case "monthlyWeekday":
          payload = buildMaintenancePayload(
            {
              ...common,
              recurrence: "monthlyWeekday",
              dayofweek: dayOfWeekBit(weekdayIndex),
              weekdayOccurrence,
              startTimeSeconds,
            },
            locale,
          );
          break;
        case "yearly":
          payload = buildMaintenancePayload(
            {
              ...common,
              recurrence: "yearly",
              month: yearlyMonth,
              monthDay: Number(monthDay),
              startTimeSeconds,
            },
            locale,
          );
          break;
        default:
          payload = buildMaintenancePayload(common, locale);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : t("maintenance.form.invalidInput"));
      return;
    }
    createMutation.mutate(payload, {
      onSuccess: reset,
      onError: (err) => setFormError(err instanceof Error ? err.message : t("maintenance.form.unknownError")),
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 p-3.5">
      <h2 className="text-[13px] font-semibold text-ink">{t("maintenance.form.title")}</h2>

      <div className="flex flex-wrap gap-1.5 text-xs text-ink-2">
        {RECURRENCE_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setRecurrence(opt.value)}
            className={`rounded-md border px-2.5 py-1.5 font-mono text-[11.5px] ${
              recurrence === opt.value
                ? "border-accent/50 bg-accent-soft font-semibold text-accent"
                : "border-line text-ink-2"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1 text-xs text-ink-2">
        {t("maintenance.form.name")}
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
        />
      </label>

      <label className="flex flex-col gap-1 text-xs text-ink-2">
        {t("maintenance.form.description")}
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="resize-none rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
        />
      </label>

      <ComboboxField
        label={t("maintenance.form.hosts")}
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
        label={t("maintenance.form.hostgroups")}
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
        {recurrence === "once" ? t("maintenance.form.start") : t("maintenance.form.frameFrom")}
        <input
          type="datetime-local"
          value={start}
          onChange={(e) => setStart(e.target.value)}
          required
          className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
        />
      </label>

      {recurrence === "daily" && (
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          {t("maintenance.form.everyNDays")}
          <input
            type="number"
            min={1}
            step={1}
            value={everyDays}
            onChange={(e) => setEveryDays(e.target.value)}
            className="w-24 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
          />
        </label>
      )}

      {recurrence === "weekly" && (
        <div className="flex flex-col gap-1.5 text-xs text-ink-2">
          {t("maintenance.form.weekdays")}
          <div className="flex flex-wrap gap-1.5">
            {weekdayLabels(locale).map((label, i) => (
              <button
                key={label}
                type="button"
                onClick={() => toggleWeekday(i)}
                className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${
                  weekdays.has(i)
                    ? "border-accent/50 bg-accent-soft font-semibold text-accent"
                    : "border-line text-ink-2"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {(recurrence === "monthlyDay" || recurrence === "yearly") && (
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          {t("maintenance.form.dayOfMonth")}
          <input
            type="number"
            min={1}
            max={31}
            step={1}
            value={monthDay}
            onChange={(e) => setMonthDay(e.target.value)}
            required
            className="w-24 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
          />
        </label>
      )}

      {recurrence === "yearly" && (
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          {t("maintenance.form.month")}
          <select
            value={yearlyMonth}
            onChange={(e) => setYearlyMonth(Number(e.target.value))}
            className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
          >
            {monthLabels(locale).map((label, i) => (
              <option key={label} value={i + 1}>
                {label}
              </option>
            ))}
          </select>
        </label>
      )}

      {recurrence === "monthlyWeekday" && (
        <div className="flex gap-2">
          <label className="flex flex-1 flex-col gap-1 text-xs text-ink-2">
            {t("maintenance.form.occurrence")}
            <select
              value={weekdayOccurrence}
              onChange={(e) => setWeekdayOccurrence(Number(e.target.value))}
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
            >
              {weekdayOccurrenceLabels(locale)
                .slice(1)
                .map((label, i) => (
                  <option key={label} value={i + 1}>
                    {label}
                  </option>
                ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs text-ink-2">
            {t("maintenance.form.weekday")}
            <select
              value={weekdayIndex}
              onChange={(e) => setWeekdayIndex(Number(e.target.value))}
              className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
            >
              {weekdayFullLabels(locale).map((label, i) => (
                <option key={label} value={i}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {recurrence !== "once" && (
        <label className="flex flex-col gap-1 text-xs text-ink-2">
          {t("maintenance.form.time")}
          <input
            type="time"
            value={recurringTime}
            onChange={(e) => setRecurringTime(e.target.value)}
            required
            className="rounded-md border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] text-ink"
          />
        </label>
      )}

      <div className="flex flex-col gap-1.5 text-xs text-ink-2">
        {t("maintenance.form.duration")}
        <div className="flex flex-wrap gap-1.5">
          {DURATION_PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => {
                setDurationMinutes(preset.minutes);
                setCustomDuration("");
              }}
              className={`rounded-full border px-2.5 py-1 font-mono text-[11px] ${
                !customDuration && durationMinutes === preset.minutes
                  ? "border-accent/50 bg-accent-soft font-semibold text-accent"
                  : "border-line text-ink-2"
              }`}
            >
              {preset.label}
            </button>
          ))}
          <input
            type="number"
            min={1}
            step={1}
            placeholder={t("maintenance.form.customDurationPlaceholder")}
            value={customDuration}
            onChange={(e) => setCustomDuration(e.target.value)}
            className="w-24 rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink"
          />
          <select
            value={customDurationUnit}
            onChange={(e) => setCustomDurationUnit(e.target.value as "minutes" | "hours")}
            className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-[11px] text-ink"
          >
            <option value="minutes">{t("maintenance.form.minutes")}</option>
            <option value="hours">{t("maintenance.form.hours")}</option>
          </select>
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs text-ink-2">
        <input
          type="checkbox"
          checked={withDataCollection}
          onChange={(e) => setWithDataCollection(e.target.checked)}
        />
        {t("maintenance.form.keepDataCollection")}
      </label>

      {formError && <div className="text-xs text-sev-high">{formError}</div>}

      <button
        type="submit"
        disabled={createMutation.isPending}
        className="rounded-md bg-accent px-3 py-1.5 text-xs font-semibold text-accent-ink disabled:opacity-50"
      >
        {createMutation.isPending ? t("maintenance.form.submitting") : t("maintenance.form.submit")}
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
  const t = useT();
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
          placeholder={t("maintenance.form.filterPlaceholder")}
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
                aria-label={t("maintenance.form.removeSelection", o.label)}
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
