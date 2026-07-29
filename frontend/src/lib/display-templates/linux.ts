import type { DisplayTemplate } from "./types";

/**
 * Default display template for Linux hosts monitored via the stock
 * "Linux by Zabbix agent" (or Cygnus fork) templates. The net.if.* and
 * vfs.fs.* families are agent-generic and reused by windows.ts unchanged.
 */
export const linuxTemplate: DisplayTemplate = {
  id: "linux",
  label: "Linux (Standard)",
  match: {
    templateNames: [
      "^Linux by Zabbix agent",
      ".*Linux by Zabbix agent.*",
      "^Cygnus Linux by Zabbix agent",
      "^Template OS Linux.*",
    ],
    keyPatterns: ["^system\\.", "^vfs\\.", "^net\\.if\\.", "^vm\\.memory\\.", "^kernel\\.", "^proc\\."],
  },
  bundles: [
    {
      id: "load",
      label: "Load",
      navGroup: "System",
      items: [
        { keyPattern: "^system\\.cpu\\.load\\[.*avg1\\]$", seriesLabel: "1m" },
        { keyPattern: "^system\\.cpu\\.load\\[.*avg5\\]$", seriesLabel: "5m" },
        { keyPattern: "^system\\.cpu\\.load\\[.*avg15\\]$", seriesLabel: "15m" },
      ],
    },
    {
      id: "cpu-times",
      label: "CPU Times",
      navGroup: "System",
      items: [
        { keyPattern: "^system\\.cpu\\.util\\[.*,user[^,\\]]*.*\\]$", seriesLabel: "User" },
        { keyPattern: "^system\\.cpu\\.util\\[.*,system[^,\\]]*.*\\]$", seriesLabel: "System" },
        { keyPattern: "^system\\.cpu\\.util\\[.*,iowait[^,\\]]*.*\\]$", seriesLabel: "IO Wait" },
        { keyPattern: "^system\\.cpu\\.util\\[.*,steal[^,\\]]*.*\\]$", seriesLabel: "Steal" },
        { keyPattern: "^system\\.cpu\\.util\\[.*,interrupt[^,\\]]*.*\\]$", seriesLabel: "Interrupt" },
        { keyPattern: "^system\\.cpu\\.util\\[.*,softirq[^,\\]]*.*\\]$", seriesLabel: "SoftIRQ" },
        { keyPattern: "^system\\.cpu\\.util\\[.*,nice[^,\\]]*.*\\]$", seriesLabel: "Nice" },
        { keyPattern: "^system\\.cpu\\.util\\[.*,idle[^,\\]]*.*\\]$", seriesLabel: "Idle" },
      ],
    },
    {
      id: "memory",
      label: "Memory",
      navGroup: "System",
      items: [
        { keyPattern: "^vm\\.memory\\.size\\[total\\]$", seriesLabel: "Total" },
        { keyPattern: "^vm\\.memory\\.size\\[available\\]$", seriesLabel: "Available" },
        { keyPattern: "^vm\\.memory\\.size\\[used\\]$", seriesLabel: "Used" },
      ],
    },
    {
      id: "icmp",
      label: "ICMP",
      navGroup: "Netzwerk",
      items: [
        { keyPattern: "^icmppingsec\\[.*\\]$|^icmppingsec$", seriesLabel: "RTT v4", role: "line" },
        { keyPattern: "^icmppingsec6(\\[.*\\])?$", seriesLabel: "RTT v6", role: "line" },
        { keyPattern: "^icmppingloss\\[.*\\]$|^icmppingloss$", seriesLabel: "Loss v4", role: "stat" },
        { keyPattern: "^icmppingloss6(\\[.*\\])?$", seriesLabel: "Loss v6", role: "stat" },
        { keyPattern: "^icmpping\\[.*\\]$|^icmpping$", seriesLabel: "Ping v4", role: "status" },
        { keyPattern: "^icmpping6(\\[.*\\])?$", seriesLabel: "Ping v6", role: "status" },
      ],
    },
  ],
  families: [
    {
      id: "net-if",
      labelPattern: "Interface {instance}",
      navGroup: "Netzwerk",
      keyPatterns: [
        { pattern: "^net\\.if\\.in\\[(.+)\\]$", seriesRole: "in" },
        { pattern: "^net\\.if\\.out\\[(.+)\\]$", seriesRole: "out" },
        { pattern: "^net\\.if\\.in\\.errors\\[(.+)\\]$", seriesRole: "errors", seriesLabel: "Errors in" },
        { pattern: "^net\\.if\\.out\\.errors\\[(.+)\\]$", seriesRole: "errors", seriesLabel: "Errors out" },
        { pattern: "^net\\.if\\.status\\[(.+)\\]$", seriesRole: "status" },
      ],
    },
    {
      id: "vfs-fs",
      labelPattern: "{instance}",
      navGroup: "Filesystem",
      keyPatterns: [
        { pattern: "^vfs\\.fs\\.size\\[(.+),free\\]$", seriesRole: "value", seriesLabel: "Free" },
        { pattern: "^vfs\\.fs\\.size\\[(.+),used\\]$", seriesRole: "value", seriesLabel: "Used" },
        { pattern: "^vfs\\.fs\\.size\\[(.+),total\\]$", seriesRole: "value", seriesLabel: "Total" },
        { pattern: "^vfs\\.fs\\.size\\[(.+),pfree\\]$", seriesRole: "value", seriesLabel: "% Free" },
        { pattern: "^vfs\\.fs\\.size\\[(.+),pused\\]$", seriesRole: "value", seriesLabel: "% Used" },
      ],
    },
  ],
};
