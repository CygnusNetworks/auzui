import type { DisplayTemplate } from "./types";

/**
 * Default display template for Windows hosts. The net.if.* and vfs.fs.*
 * families are the same agent-generic keys as linux.ts (they work identically on a
 * Windows agent, just with drive letters as filesystem instances); the
 * bundles instead match the perf_counter/wmi.get key shapes common on
 * Windows templates, alongside the plain agent keys where they overlap.
 */
export const windowsTemplate: DisplayTemplate = {
  id: "windows",
  label: "Windows (Standard)",
  match: {
    templateNames: [
      "^Windows by Zabbix agent",
      ".*Windows by Zabbix agent.*",
      "^Cygnus Windows by Zabbix agent",
      "^Template OS Windows.*",
    ],
    keyPatterns: ["^perf_counter", "^wmi\\.get", "^vm\\.memory\\.", "^net\\.if\\.", "^vfs\\.fs\\."],
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
        {
          keyPattern: "^perf_counter\\[.*Processor\\(_Total\\)\\\\% User Time.*\\]$",
          seriesLabel: "User",
        },
        {
          keyPattern: "^perf_counter\\[.*Processor\\(_Total\\)\\\\% Privileged Time.*\\]$",
          seriesLabel: "Privileged",
        },
        {
          keyPattern: "^perf_counter\\[.*Processor\\(_Total\\)\\\\% Idle Time.*\\]$",
          seriesLabel: "Idle",
        },
        { keyPattern: "^perf_counter\\[.*Processor\\(_Total\\)\\\\% Interrupt Time.*\\]$", seriesLabel: "Interrupt" },
        { keyPattern: "^system\\.cpu\\.util\\[.*,user[^,\\]]*.*\\]$", seriesLabel: "User" },
        { keyPattern: "^system\\.cpu\\.util\\[.*,system[^,\\]]*.*\\]$", seriesLabel: "System" },
      ],
    },
    {
      id: "memory",
      label: "Memory",
      navGroup: "System",
      items: [
        { keyPattern: "^vm\\.memory\\.size\\[total\\]$", seriesLabel: "Total" },
        { keyPattern: "^vm\\.memory\\.size\\[available\\]$", seriesLabel: "Available" },
        { keyPattern: "^wmi\\.get\\[.*FreePhysicalMemory.*\\]$", seriesLabel: "Free (WMI)" },
        { keyPattern: "^perf_counter\\[.*Memory\\\\Available Bytes.*\\]$", seriesLabel: "Available (perf)" },
      ],
    },
    {
      id: "icmp",
      label: "ICMP",
      navGroup: "Netzwerk",
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
      // Same agent-generic net.if key shape as linux.ts: the interface name is
      // the first key parameter, direction/mode (dropped/errors) follow it —
      // capture only the interface so all series group into one family.
      keyPatterns: [
        { pattern: '^net\\.if\\.in\\["?([^",\\]]+)"?\\]$', seriesRole: "in" },
        { pattern: '^net\\.if\\.out\\["?([^",\\]]+)"?\\]$', seriesRole: "out" },
        { pattern: '^net\\.if\\.in\\["?([^",\\]]+)"?,\\s*dropped\\]$', seriesRole: "dropped", seriesLabel: "Dropped in", displayRole: "stat" },
        { pattern: '^net\\.if\\.out\\["?([^",\\]]+)"?,\\s*dropped\\]$', seriesRole: "dropped", seriesLabel: "Dropped out", displayRole: "stat" },
        { pattern: '^net\\.if\\.in\\["?([^",\\]]+)"?,\\s*errors\\]$', seriesRole: "errors", seriesLabel: "Errors in", displayRole: "stat" },
        { pattern: '^net\\.if\\.out\\["?([^",\\]]+)"?,\\s*errors\\]$', seriesRole: "errors", seriesLabel: "Errors out", displayRole: "stat" },
        { pattern: '^net\\.if\\.status\\["?([^",\\]]+)"?\\]$', seriesRole: "status" },
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
      ],
    },
  ],
};
