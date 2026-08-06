/**
 * Pragmatic TypeScript types for the Zabbix JSON-RPC methods auzui uses.
 * These are intentionally not exhaustive — they cover the fields the UI
 * consumes. All Zabbix ids and numeric enums arrive as strings on the wire.
 */

export type ZabbixId = string;

/** JSON-RPC error object as returned by api_jsonrpc.php. */
export interface ZabbixApiErrorShape {
  code: number;
  message: string;
  data?: string;
}

export interface ZabbixHostInterface {
  interfaceid: ZabbixId;
  ip: string;
  dns: string;
  useip: "0" | "1";
  port: string;
  /** 1 agent, 2 SNMP, 3 IPMI, 4 JMX */
  type: "1" | "2" | "3" | "4";
}

export interface ZabbixTemplate {
  templateid: ZabbixId;
  name: string;
}

export interface ZabbixHostGroup {
  groupid: ZabbixId;
  name: string;
}

export interface ZabbixHost {
  hostid: ZabbixId;
  host: string;
  name: string;
  status: "0" | "1";
  maintenance_status?: "0" | "1";
  /** Set while maintenance_status is "1" — id of the currently active maintenance. */
  maintenanceid?: ZabbixId;
  /**
   * Zabbix ≥7.0: who collects this host's data — "0" server, "1" a single
   * proxy (`proxyid`), "2" a proxy group (`proxy_groupid`). Beware: for a
   * proxy-group host `proxyid` is "0"; the proxy currently doing the work is
   * `assigned_proxyid` and moves on failover.
   */
  monitored_by?: "0" | "1" | "2";
  proxyid?: ZabbixId;
  proxy_groupid?: ZabbixId;
  /** Read-only — proxy the group has currently assigned (monitored_by "2"). */
  assigned_proxyid?: ZabbixId;
  interfaces?: ZabbixHostInterface[];
  parentTemplates?: ZabbixTemplate[];
  hostgroups?: ZabbixHostGroup[];
  inventory?: Record<string, string>;
}

export interface ZabbixItemTag {
  tag: string;
  value: string;
}

export interface ZabbixItem {
  itemid: ZabbixId;
  hostid: ZabbixId;
  name: string;
  /**
   * Zabbix 7.0+ item.get field: `name` with all supported macros (LLD `{#…}`,
   * `{HOST.NAME}`, user macros) resolved server-side. Optional — absent on
   * older servers or when not requested; prefer it over `name` for display.
   */
  name_resolved?: string;
  key_: string;
  /** 0 float, 1 char, 2 log, 3 uint, 4 text */
  value_type: "0" | "1" | "2" | "3" | "4";
  units: string;
  lastvalue?: string;
  lastclock?: string;
  prevvalue?: string;
  tags?: ZabbixItemTag[];
  status?: "0" | "1";
  state?: "0" | "1";
  /** 0 normal, 1 discovery rule, 2 item prototype (n/a on item.get), 4 discovered (created by LLD). */
  flags?: "0" | "1" | "2" | "4";
  /**
   * Only present with `selectItemDiscovery` — set for LLD-discovered items
   * (flags "4"). `key_` here is the *item prototype's* key with its LLD
   * macros (`{#SNMPINDEX}` etc.) unresolved, so it's directly comparable to
   * `itemprototype.get({templateids}).key_`.
   */
  itemDiscovery?: { parent_itemid: ZabbixId; key_: string };
  hosts?: Pick<ZabbixHost, "hostid" | "host" | "name">[];
}

/** An item prototype as returned by `itemprototype.get`. With `templateids`, `hostid` is the templateid. */
export interface ZabbixItemPrototype {
  itemid: ZabbixId;
  hostid: ZabbixId;
  key_: string;
  name?: string;
}

export type ZabbixSeverity = "0" | "1" | "2" | "3" | "4" | "5";

export interface ZabbixProblem {
  eventid: ZabbixId;
  objectid: ZabbixId;
  name: string;
  severity: ZabbixSeverity;
  clock: string;
  acknowledged: "0" | "1";
  suppressed?: "0" | "1";
  /** Present when suppressed — one entry per active suppression (maintenance or manual). */
  suppression_data?: {
    maintenanceid?: ZabbixId;
    userid?: ZabbixId;
    /** Unix seconds, "0" = indefinite (manual suppression). */
    suppress_until?: string;
  }[];
  opdata?: string;
  tags?: ZabbixItemTag[];
}

export interface ZabbixEventAcknowledge {
  acknowledgeid: ZabbixId;
  userid: ZabbixId;
  eventid: ZabbixId;
  clock: string;
  message: string;
  /** action bitmask: 1 close, 2 ack, 4 message, 8 change severity, 16 unack, 32 suppress, 64 unsuppress */
  action: string;
  /** Set on action bit 8 (change severity). */
  old_severity?: ZabbixSeverity;
  new_severity?: ZabbixSeverity;
  /** Set on action bit 32 (suppress) — unix timestamp, "0" = indefinite. */
  suppress_until?: string;
}

export interface ZabbixEvent {
  eventid: ZabbixId;
  source: string;
  object: string;
  objectid: ZabbixId;
  clock: string;
  value: string;
  severity?: ZabbixSeverity;
  name?: string;
  hosts?: Pick<ZabbixHost, "hostid" | "host" | "name">[];
  acknowledges?: ZabbixEventAcknowledge[];
}

export interface ZabbixTrigger {
  triggerid: ZabbixId;
  description: string;
  expression: string;
  priority: ZabbixSeverity;
  value?: "0" | "1";
  status?: "0" | "1";
  /** "1" = the trigger allows manual problem closing (event.acknowledge action 1). */
  manual_close?: "0" | "1";
  hosts?: Pick<ZabbixHost, "hostid" | "host">[];
  items?: (Pick<ZabbixItem, "itemid" | "key_" | "name" | "value_type" | "lastvalue" | "lastclock"> &
    Partial<Pick<ZabbixItem, "units">>)[];
}

export interface ZabbixHistoryPoint {
  itemid: ZabbixId;
  clock: string;
  value: string;
  ns?: string;
}

export interface ZabbixTrendPoint {
  itemid: ZabbixId;
  clock: string;
  num: string;
  value_min: string;
  value_avg: string;
  value_max: string;
}

export interface ZabbixDiscoveryRule {
  itemid: ZabbixId;
  hostid: ZabbixId;
  name: string;
  key_: string;
}

export interface ZabbixMapElement {
  selementid: ZabbixId;
  /** 0 host, 1 map, 2 trigger, 3 host group, 4 image — auzui only resolves "0" (host). */
  elementtype: string;
  label: string;
  x: string;
  y: string;
  /** Present when elementtype "0"; auzui reads elements[0].hostid. */
  elements?: { hostid: ZabbixId }[];
}

export interface ZabbixMapLink {
  linkid: ZabbixId;
  selementid1: ZabbixId;
  selementid2: ZabbixId;
}

export interface ZabbixMap {
  sysmapid: ZabbixId;
  name: string;
  width: string;
  height: string;
  selements?: ZabbixMapElement[];
  links?: ZabbixMapLink[];
}

export interface ZabbixTimeperiod {
  timeperiodid?: ZabbixId;
  /** "0" one-time, "2" daily, "3" weekly, "4" monthly. */
  timeperiod_type: string;
  /** Unix seconds — one-time periods only. */
  start_date?: string;
  /** Duration in seconds. */
  period: string;
  /** Repeat interval (every Nth day/week/month) — daily/weekly/monthly only. */
  every?: string;
  /** Bitmask, bit0=Mon…bit6=Sun — weekly, and monthly "day of week in month" mode. */
  dayofweek?: string;
  /** Seconds since midnight — daily/weekly/monthly. */
  start_time?: string;
  /** Bitmask of months, bit0=Jan…bit11=Dec — monthly. */
  month?: string;
  /** Day of month — monthly, when dayofweek is "0". */
  day?: string;
}

/** Zabbix ≥7.0 renamed the proxy "host" field to "name" (proxy.get). */
export interface ZabbixProxy {
  proxyid: ZabbixId;
  name: string;
}

/** Zabbix ≥7.0 proxy group — hosts are assigned to one of its proxies at runtime. */
export interface ZabbixProxyGroup {
  proxy_groupid: ZabbixId;
  name: string;
}

export interface ZabbixMaintenance {
  maintenanceid: ZabbixId;
  name: string;
  active_since: string;
  active_till: string;
  /** 0 = mit Datenerfassung, 1 = ohne. */
  maintenance_type: "0" | "1";
  description: string;
  hosts?: Pick<ZabbixHost, "hostid" | "host" | "name">[];
  hostgroups?: ZabbixHostGroup[];
  timeperiods?: ZabbixTimeperiod[];
}

export interface ZabbixHttpStep {
  httpstepid: ZabbixId;
  httptestid: ZabbixId;
  name: string;
  /** 1-based step order within the scenario. */
  no: string;
  url: string;
  /** Seconds. */
  timeout: string;
  /** Text/regex the response body must contain — empty if unset. */
  required?: string;
  /** Comma-separated list of accepted HTTP codes, e.g. "200,301" — empty if unset. */
  status_codes?: string;
}

export interface ZabbixHttpTest {
  httptestid: ZabbixId;
  name: string;
  hostid: ZabbixId;
  /** Check interval, e.g. "1m". */
  delay: string;
  retries: string;
  /** 0 enabled, 1 disabled. */
  status: "0" | "1";
  agent: string;
  steps?: ZabbixHttpStep[];
  hosts?: Pick<ZabbixHost, "hostid" | "host" | "name">[];
}

/** Common "get" parameter shapes (subset). */
export interface GetParamsBase {
  output?: "extend" | string[];
  limit?: number;
  sortfield?: string | string[];
  sortorder?: "ASC" | "DESC" | ("ASC" | "DESC")[];
  filter?: Record<string, unknown>;
  search?: Record<string, string>;
  searchWildcardsEnabled?: boolean;
  /**
   * Zabbix defaults to AND-ing every field in `search` — with searchByAny:
   * true it becomes OR, so e.g. `search:{name,key_}` actually matches either
   * field instead of requiring both to contain the term.
   */
  searchByAny?: boolean;
}
