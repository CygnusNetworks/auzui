import type { ZabbixItem, ZabbixItemPrototype } from "@auzui/zabbix-client";

/**
 * Reine Zuordnungsfunktion Item → Template für den Host-Deep-Dive
 * Template-Filter. Kein Netzwerkzugriff.
 *
 * Zabbix-Host-Items tragen die verlinkte templateid nicht direkt. Zwei Wege
 * führen zur Zuordnung:
 *
 * 1. Geerbte (nicht-discovered) Items behalten den `key_` des
 *    Template-Items unverändert — Abgleich also einfach über `key_` gegen
 *    `templateItems` (deren `hostid` bei `item.get({templateids})` die
 *    templateid ist).
 * 2. Per LLD entdeckte Items (flags "4" — bei Switches/Docker-Hosts die
 *    überwältigende Mehrheit) haben einen aufgelösten Key wie
 *    `net.if.type[ifType.12]`, der in keinem Template als Item existiert;
 *    im Template gibt es nur das Item-Prototype
 *    `net.if.type[ifType.{#SNMPINDEX}]`. `item.get` liefert mit
 *    `selectItemDiscovery` pro discovered Item `itemDiscovery.key_` — das
 *    ist exakt der Prototype-Key mit unaufgelösten `{#MACRO}`s, also direkt
 *    gegen `itemprototype.get({templateids}).key_` matchbar (`hostid` dort
 *    ist wieder die templateid).
 *
 * key_-Kollisionen zwischen zwei Templates sind unkritisch: Zabbix verbietet
 * das Verlinken zweier Templates mit identischem Item-Key an denselben Host,
 * ein Host-Item kann also nie über beide Wege zu unterschiedlichen
 * Templates passen (empirisch über 12 Hosts / 3667 Items bestätigt: keine
 * einzige Mehrfachzuordnung).
 */
export function buildTemplateItemIds(
  items: ZabbixItem[],
  templateItems: Pick<ZabbixItem, "hostid" | "key_">[],
  templatePrototypes: Pick<ZabbixItemPrototype, "hostid" | "key_">[],
): Map<string, Set<string>> {
  // key_ -> templateid, and prototype key_ -> templateid. Built once so the
  // main pass over items is O(items), not O(templates × items).
  const templateIdByItemKey = new Map<string, string>();
  for (const templateItem of templateItems) {
    templateIdByItemKey.set(templateItem.key_, templateItem.hostid);
  }
  const templateIdByProtoKey = new Map<string, string>();
  for (const proto of templatePrototypes) {
    templateIdByProtoKey.set(proto.key_, proto.hostid);
  }

  const result = new Map<string, Set<string>>();
  // Ensure every template has an entry, even if no host item matches it —
  // callers distinguish "0 Items" from "kein Mapping" via map presence.
  for (const templateid of templateIdByItemKey.values()) {
    if (!result.has(templateid)) result.set(templateid, new Set());
  }
  for (const templateid of templateIdByProtoKey.values()) {
    if (!result.has(templateid)) result.set(templateid, new Set());
  }

  for (const item of items) {
    const templateid =
      templateIdByItemKey.get(item.key_) ??
      (item.itemDiscovery ? templateIdByProtoKey.get(item.itemDiscovery.key_) : undefined);
    if (templateid === undefined) continue;
    result.get(templateid)!.add(item.itemid);
  }

  return result;
}
