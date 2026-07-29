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
  elementtype: string;
  label: string;
  x: string;
  y: string;
}

export interface ZabbixMap {
  sysmapid: ZabbixId;
  name: string;
  width: string;
  height: string;
  selements?: ZabbixMapElement[];
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
}
