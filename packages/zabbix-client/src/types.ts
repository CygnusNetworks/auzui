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
  proxyid?: ZabbixId;
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
  hosts?: Pick<ZabbixHost, "hostid" | "host" | "name">[];
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
  opdata?: string;
  tags?: ZabbixItemTag[];
}

export interface ZabbixEventAcknowledge {
  acknowledgeid: ZabbixId;
  userid: ZabbixId;
  eventid: ZabbixId;
  clock: string;
  message: string;
  /** action bitmask: 1 close, 2 ack, 4 message, 8 change severity, 16 unack */
  action: string;
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
  hosts?: Pick<ZabbixHost, "hostid" | "host">[];
  items?: Pick<ZabbixItem, "itemid" | "key_" | "name" | "value_type">[];
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
