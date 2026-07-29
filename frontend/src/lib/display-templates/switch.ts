import type { DisplayTemplate } from "./types";

/**
 * Default display template for SNMP-monitored network switches. Interfaces
 * are discovered via LLD into keys like net.if.in[ifHCInOctets,{#SNMPINDEX}]
 * — a different key shape than the agent-generic net.if.in[eth0] used by
 * linux.ts/windows.ts, so this family is defined separately.
 */
export const switchTemplate: DisplayTemplate = {
  id: "switch",
  label: "Switch (SNMP, Standard)",
  match: {
    templateNames: [".*SNMP.*", "^Generic SNMP.*", "^Cisco IOS.*", "^Brocade/Foundry.*", ".*Switch.*"],
    keyPatterns: ["^net\\.if\\.(in|out)\\[ifHC", "^icmpping"],
  },
  bundles: [
    {
      id: "icmp",
      label: "ICMP",
      navGroup: "System",
      items: [
        { keyPattern: "^icmpping(6)?(\\[.*\\])?$", seriesLabel: "Ping (up/down)" },
        { keyPattern: "^icmppingsec(6)?(\\[.*\\])?$", seriesLabel: "Latency" },
        { keyPattern: "^icmppingloss(6)?(\\[.*\\])?$", seriesLabel: "Loss %" },
      ],
    },
  ],
  families: [
    {
      id: "net-if",
      labelPattern: "Interface {instance}",
      navGroup: "Netzwerk",
      keyPatterns: [
        { pattern: "^net\\.if\\.in\\[ifHCInOctets,(.+)\\]$", seriesRole: "in" },
        { pattern: "^net\\.if\\.out\\[ifHCOutOctets,(.+)\\]$", seriesRole: "out" },
        { pattern: "^net\\.if\\.in\\[ifInErrors,(.+)\\]$", seriesRole: "errors", seriesLabel: "Errors in" },
        { pattern: "^net\\.if\\.out\\[ifOutErrors,(.+)\\]$", seriesRole: "errors", seriesLabel: "Errors out" },
        { pattern: "^net\\.if\\.status\\[ifOperStatus,(.+)\\]$", seriesRole: "status" },
      ],
    },
  ],
};
