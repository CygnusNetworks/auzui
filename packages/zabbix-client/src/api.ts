import type { ZabbixClient } from "./client";
import type {
  GetParamsBase,
  ZabbixDiscoveryRule,
  ZabbixEvent,
  ZabbixHistoryPoint,
  ZabbixHost,
  ZabbixHostGroup,
  ZabbixId,
  ZabbixItem,
  ZabbixMap,
  ZabbixProblem,
  ZabbixTrendPoint,
  ZabbixTrigger,
} from "./types";

/**
 * Typed wrappers for the JSON-RPC methods auzui uses. Parameter shapes are
 * pragmatic subsets; anything else can go through `client.call` directly.
 */
export class ZabbixApi {
  constructor(readonly client: ZabbixClient) {}

  /** Logs in and stores the session token on the client. */
  async login(username: string, password: string): Promise<string> {
    const token = await this.client.call<string>("user.login", { username, password });
    this.client.setToken(token);
    return token;
  }

  async logout(): Promise<void> {
    await this.client.call<boolean>("user.logout", []);
    this.client.setToken(undefined);
  }

  apiVersion(): Promise<string> {
    return this.client.call<string>("apiinfo.version", []);
  }

  hostGet(
    params: GetParamsBase & {
      groupids?: ZabbixId[];
      hostids?: ZabbixId[];
      selectInterfaces?: "extend" | string[];
      selectParentTemplates?: "extend" | string[];
      selectHostGroups?: "extend" | string[];
      selectInventory?: "extend" | string[];
    } = {},
  ): Promise<ZabbixHost[]> {
    return this.client.call("host.get", params);
  }

  hostgroupGet(
    params: GetParamsBase & { with_hosts?: boolean; with_monitored_items?: boolean } = {},
  ): Promise<ZabbixHostGroup[]> {
    return this.client.call("hostgroup.get", params);
  }

  itemGet(
    params: GetParamsBase & {
      hostids?: ZabbixId[];
      itemids?: ZabbixId[];
      groupids?: ZabbixId[];
      webitems?: boolean;
      selectTags?: "extend";
      tags?: { tag: string; value?: string; operator?: number }[];
      monitored?: boolean;
    } = {},
  ): Promise<ZabbixItem[]> {
    return this.client.call("item.get", params);
  }

  problemGet(
    params: GetParamsBase & {
      hostids?: ZabbixId[];
      groupids?: ZabbixId[];
      severities?: number[];
      acknowledged?: boolean;
      suppressed?: boolean;
      recent?: boolean;
      eventid_from?: ZabbixId;
      selectTags?: "extend";
    } = {},
  ): Promise<ZabbixProblem[]> {
    return this.client.call("problem.get", params);
  }

  eventGet(
    params: GetParamsBase & {
      eventids?: ZabbixId[];
      hostids?: ZabbixId[];
      time_from?: number;
      time_till?: number;
      selectHosts?: "extend" | string[];
      select_acknowledges?: "extend" | string[];
      value?: number[];
    } = {},
  ): Promise<ZabbixEvent[]> {
    return this.client.call("event.get", params);
  }

  /**
   * Acknowledge / comment / close problems. `action` is a bitmask:
   * 1 close, 2 ack, 4 message, 8 change severity, 16 unack.
   */
  eventAcknowledge(params: {
    eventids: ZabbixId[];
    action: number;
    message?: string;
    severity?: number;
  }): Promise<{ eventids: ZabbixId[] }> {
    return this.client.call("event.acknowledge", params);
  }

  /** value_type is the history table selector: 0 float, 3 uint, … */
  historyGet(
    params: GetParamsBase & {
      itemids: ZabbixId[];
      history: number;
      time_from?: number;
      time_till?: number;
    },
  ): Promise<ZabbixHistoryPoint[]> {
    return this.client.call("history.get", params);
  }

  trendGet(
    params: GetParamsBase & {
      itemids: ZabbixId[];
      time_from?: number;
      time_till?: number;
    },
  ): Promise<ZabbixTrendPoint[]> {
    return this.client.call("trend.get", params);
  }

  triggerGet(
    params: GetParamsBase & {
      hostids?: ZabbixId[];
      itemids?: ZabbixId[];
      triggerids?: ZabbixId[];
      expandExpression?: boolean;
      selectItems?: "extend" | string[];
      selectHosts?: "extend" | string[];
      only_true?: boolean;
      monitored?: boolean;
    } = {},
  ): Promise<ZabbixTrigger[]> {
    return this.client.call("trigger.get", params);
  }

  discoveryruleGet(
    params: GetParamsBase & { hostids?: ZabbixId[] } = {},
  ): Promise<ZabbixDiscoveryRule[]> {
    return this.client.call("discoveryrule.get", params);
  }

  mapGet(
    params: GetParamsBase & { sysmapids?: ZabbixId[]; selectSelements?: "extend" } = {},
  ): Promise<ZabbixMap[]> {
    return this.client.call("map.get", params);
  }
}
