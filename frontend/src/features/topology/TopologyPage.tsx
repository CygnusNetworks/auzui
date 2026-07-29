import { useMemo, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { useHostGroups } from "../hosts/use-hosts";
import type { TopologyEdge, TopologyEdgeLevel, TopologyNode } from "../../lib/topology";
import { matchesSeverityFilter, SEVERITY_LABEL, type SeverityFilter } from "../../lib/severity";
import { validateTopologySearch } from "./search-params";
import { useTopology } from "./use-topology";
import { FilterBar } from "./FilterBar";
import { GraphView } from "./GraphView";
import { MapView } from "./MapView";

type LayerKey = TopologyEdgeLevel;

/** Above this many hosts, only show hosts with active problems + their subnet neighbors initially (PLAN.md). */
const MAX_INITIAL_HOSTS = 250;

function isHostNodeId(id: string): boolean {
  return id.startsWith("host:");
}

/** PLAN.md: >250 hosts → only problem hosts + their subnet neighbors, unless "alle anzeigen" is on. */
function reduceForLargeGraphs(
  nodes: TopologyNode[],
  edges: TopologyEdge[],
  showAll: boolean,
): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  const hostNodes = nodes.filter((n) => n.kind === "host");
  if (showAll || hostNodes.length <= MAX_INITIAL_HOSTS) return { nodes, edges };

  const problemHostIds = new Set(hostNodes.filter((n) => n.severity !== undefined).map((n) => n.id));
  const subnetIdsOfProblemHosts = new Set(
    edges.filter((e) => e.level === "l3" && problemHostIds.has(e.source)).map((e) => e.target),
  );
  const visibleHostIds = new Set(problemHostIds);
  for (const e of edges) {
    if (e.level === "l3" && subnetIdsOfProblemHosts.has(e.target)) visibleHostIds.add(e.source);
  }

  const visibleIds = new Set<string>(visibleHostIds);
  for (const n of nodes) if (n.kind !== "host") visibleIds.add(n.id); // pruned below once edges are known

  const filteredEdges = edges.filter((e) => visibleIds.has(e.source) && visibleIds.has(e.target));
  const idsWithEdge = new Set<string>();
  for (const e of filteredEdges) {
    idsWithEdge.add(e.source);
    idsWithEdge.add(e.target);
  }
  const filteredNodes = nodes.filter((n) => (n.kind === "host" ? visibleHostIds.has(n.id) : idsWithEdge.has(n.id)));
  return { nodes: filteredNodes, edges: filteredEdges };
}

/**
 * Auto-Topologie (/topology, PLAN.md M3 + Phase 2 C Entwurf 2 + Redesign).
 * Force-layout SVG graph with Maps/L3/Proxy layer toggles, or a Geomap
 * (?view=map) from inventory location_lat/lon with a world-land.json kulisse
 * — both without any external mapping dependency. TopologyPage owns data
 * fetching + the shared filter pipeline (severity/group/proxy/search);
 * GraphView/MapView own only rendering + pan/zoom.
 */
export function TopologyPage() {
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateTopologySearch(rawSearch);
  const navigate = useNavigate();
  const view = search.view ?? "graph";

  const { graph, hosts, isLoading, problemsByHost } = useTopology();
  const groupsQuery = useHostGroups();
  const groups = groupsQuery.data ?? [];
  const hostByHostId = useMemo(() => new Map(hosts.map((h) => [h.hostid, h])), [hosts]);
  const problemCountByHostId = useMemo(
    () => new Map([...problemsByHost.entries()].map(([id, s]) => [id, s.count])),
    [problemsByHost],
  );

  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ explicit: true, l3: true, logical: true });
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
  const [groupFilter, setGroupFilter] = useState<string | undefined>(undefined);
  const [proxyFilter, setProxyFilter] = useState<string | undefined>(undefined);

  const proxyIds = useMemo(
    () => [...new Set(hosts.map((h) => h.proxyid).filter((id): id is string => Boolean(id)))].sort(),
    [hosts],
  );

  function setView(next: "graph" | "map") {
    void navigate({ to: "/topology", search: (prev) => ({ ...prev, view: next === "map" ? "map" : undefined }) });
  }

  const hostVisibleSet = useMemo(() => {
    const set = new Set<string>();
    for (const h of hosts) {
      if (groupFilter && !(h.hostgroups ?? []).some((g) => g.groupid === groupFilter)) continue;
      if (proxyFilter && h.proxyid !== proxyFilter) continue;
      const severity = problemsByHost.get(h.hostid)?.maxSeverity;
      if (!matchesSeverityFilter(severity, severityFilter)) continue;
      set.add(`host:${h.hostid}`);
    }
    return set;
  }, [hosts, groupFilter, proxyFilter, severityFilter, problemsByHost]);

  const reduced = useMemo(
    () => reduceForLargeGraphs(graph.nodes, graph.edges, showAll),
    [graph.nodes, graph.edges, showAll],
  );

  const filterEdges = useMemo(
    () =>
      reduced.edges.filter((e) => {
        const sOk = !isHostNodeId(e.source) || hostVisibleSet.has(e.source);
        const tOk = !isHostNodeId(e.target) || hostVisibleSet.has(e.target);
        return sOk && tOk;
      }),
    [reduced.edges, hostVisibleSet],
  );

  const layerFilteredEdges = useMemo(
    () => filterEdges.filter((e) => layers[e.level]),
    [filterEdges, layers],
  );
  const idsWithVisibleEdge = useMemo(() => {
    const s = new Set<string>();
    for (const e of layerFilteredEdges) {
      s.add(e.source);
      s.add(e.target);
    }
    return s;
  }, [layerFilteredEdges]);
  const visibleNodes = useMemo(
    () =>
      reduced.nodes.filter((n) =>
        n.kind === "host" ? hostVisibleSet.has(n.id) : idsWithVisibleEdge.has(n.id),
      ),
    [reduced.nodes, hostVisibleSet, idsWithVisibleEdge],
  );

  const mapHostNodes = useMemo(
    () => reduced.nodes.filter((n) => n.kind === "host" && hostVisibleSet.has(n.id)),
    [reduced.nodes, hostVisibleSet],
  );

  const hostCountTotal = graph.nodes.filter((n) => n.kind === "host").length;
  const isLargeGraph = hostCountTotal > MAX_INITIAL_HOSTS && !showAll;

  const currentNodeList = view === "graph" ? visibleNodes : mapHostNodes;
  const selectedNode = currentNodeList.find((n) => n.id === selectedNodeId);
  const selectedProblem = selectedNode?.hostid ? problemsByHost.get(selectedNode.hostid) : undefined;

  return (
    <div className="mx-auto max-w-[1400px] px-3 min-[700px]:px-5 pb-16 pt-4.5">
      <div className="mb-4 mt-1.5 flex flex-wrap items-baseline gap-3">
        <h1 className="text-[19px] font-bold tracking-tight">Auto-Topologie</h1>
        <span className="text-[13px] text-ink-2">
          Kanten aus Evidenz — Maps, L3-Subnetze, Proxy. Keine gepflegte Map.
        </span>
        <span className="font-mono text-[10.5px] text-ink-muted">
          generiert aus {hostCountTotal} Hosts · 0 Konfiguration
        </span>
        <div className="ml-auto inline-flex gap-0.5 rounded-lg bg-surface-3 p-0.5">
          <button
            type="button"
            onClick={() => setView("graph")}
            className={`rounded-md px-3 py-1 text-[12.5px] ${view === "graph" ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-2"}`}
          >
            Graph
          </button>
          <button
            type="button"
            onClick={() => setView("map")}
            className={`rounded-md px-3 py-1 text-[12.5px] ${view === "map" ? "bg-surface font-semibold text-ink shadow-sm" : "text-ink-2"}`}
          >
            Karte
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="rounded-lg border border-line bg-surface p-10 text-center text-sm text-ink-2">Lade…</div>
      ) : (
        <div className="grid grid-cols-[1fr_260px] items-start gap-3.5 max-[980px]:grid-cols-1">
          <div className="rounded-lg border border-line bg-surface">
            <FilterBar
              view={view}
              severityFilter={severityFilter}
              onSeverityFilterChange={setSeverityFilter}
              groups={groups}
              groupFilter={groupFilter}
              onGroupFilterChange={setGroupFilter}
              proxyIds={proxyIds}
              proxyFilter={proxyFilter}
              onProxyFilterChange={setProxyFilter}
              query={query}
              onQueryChange={setQuery}
              layers={layers}
              onToggleLayer={(key) => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
              largeGraphNotice={
                view === "graph" && isLargeGraph ? (
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[11.5px] text-ink-2"
                  >
                    Nur Probleme + Nachbarn ({visibleNodes.filter((n) => n.kind === "host").length} von{" "}
                    {hostCountTotal}) — alle anzeigen
                  </button>
                ) : undefined
              }
            />
            <div className="relative">
              {view === "graph" ? (
                <GraphView
                  nodes={visibleNodes}
                  edges={layerFilteredEdges}
                  query={query}
                  selectedNodeId={selectedNodeId}
                  onSelect={setSelectedNodeId}
                  problemCountByHostId={problemCountByHostId}
                />
              ) : (
                <MapView
                  hostNodes={mapHostNodes}
                  hostByHostId={hostByHostId}
                  query={query}
                  selectedNodeId={selectedNodeId}
                  onSelect={setSelectedNodeId}
                />
              )}
            </div>
          </div>

          <aside className="flex flex-col gap-3">
            <div className="rounded-lg border border-line bg-surface p-3">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">Legende</div>
              <div className="flex flex-col gap-1.5 text-[11.5px] text-ink-2">
                <div className="text-ink-muted">
                  Knotenfarbe = schwerstes aktives Problem, Größe = Anzahl Probleme. Positionen persistiert
                  — Layout springt nie.
                </div>
              </div>
            </div>

            {selectedNode && (
              <div className="rounded-lg border border-line bg-surface-2 p-3">
                <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                  {selectedNode.kind === "host" ? "Host" : selectedNode.kind === "subnet" ? "Subnetz" : "Proxy"}
                </div>
                <div className="mb-1 text-[13px] font-semibold text-ink">{selectedNode.label}</div>
                {selectedNode.kind === "host" && (
                  <>
                    <div className="mb-2 text-[12px] text-ink-2">
                      {selectedNode.severity !== undefined
                        ? `${SEVERITY_LABEL[selectedNode.severity]} · ${selectedProblem?.count ?? 0} Probleme`
                        : "OK — keine aktiven Probleme"}
                    </div>
                    <div className="flex gap-2">
                      <Link
                        to="/hosts/$hostId"
                        params={{ hostId: selectedNode.hostid! }}
                        className="rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-2 hover:text-ink"
                      >
                        Deep-Dive
                      </Link>
                      <Link
                        to="/"
                        search={{ host: selectedNode.hostid! }}
                        className="rounded-md border border-line bg-surface px-2.5 py-1 text-[12px] text-ink-2 hover:text-ink"
                      >
                        Probleme
                      </Link>
                    </div>
                  </>
                )}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
