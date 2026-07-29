import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import type { ZabbixHost } from "@auzui/zabbix-client";
import { computeForceLayout } from "../../lib/force-layout";
import type { TopologyEdge, TopologyEdgeLevel, TopologyNode } from "../../lib/topology";
import { SEVERITY_LABEL } from "../../lib/severity";
import { validateTopologySearch } from "./search-params";
import { useTopology } from "./use-topology";

const POSITIONS_KEY = "auzui-topology-positions";
/** Above this many hosts, only show hosts with active problems + their subnet neighbors initially (PLAN.md). */
const MAX_INITIAL_HOSTS = 250;
const LABEL_ZOOM_THRESHOLD = 1.6;
const LABEL_DENSE_CUTOFF = 100;

type LayerKey = TopologyEdgeLevel;
const LAYER_ORDER: LayerKey[] = ["explicit", "l3", "logical"];
const LAYER_LABEL: Record<LayerKey, string> = { explicit: "Maps", l3: "L3-Subnetze", logical: "Proxy" };

interface Positions {
  [nodeId: string]: { x: number; y: number };
}

function loadPositions(): Positions {
  try {
    const raw = localStorage.getItem(POSITIONS_KEY);
    return raw ? (JSON.parse(raw) as Positions) : {};
  } catch {
    return {};
  }
}

function savePositions(positions: Positions) {
  try {
    localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions));
  } catch {
    // storage unavailable/full — positions still hold for this session
  }
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

function severityNodeColor(node: TopologyNode): string {
  if (node.kind !== "host") return "var(--color-surface-3)";
  if (node.severity === undefined) return "var(--color-sev-ok)";
  const tokens: Record<number, string> = {
    5: "var(--color-sev-disaster)",
    4: "var(--color-sev-high)",
    3: "var(--color-sev-avg)",
    2: "var(--color-sev-warn)",
    1: "var(--color-sev-info)",
    0: "var(--color-ink-muted)",
  };
  return tokens[node.severity] ?? "var(--color-sev-ok)";
}

const DASH_FOR_LEVEL: Record<TopologyEdgeLevel, string | undefined> = {
  explicit: undefined,
  l3: "6 4",
  logical: "2 3",
};

interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

const INITIAL_VIEWBOX: ViewBox = { x: 0, y: 0, w: 1000, h: 700 };

/**
 * Auto-Topologie (/topology, PLAN.md M3 + Phase 2 C Entwurf 2). Force-layout
 * SVG graph with Maps/L3/Proxy layer toggles, or a coordinate-only Geomap
 * (?view=map) from inventory location_lat/lon — both without any external
 * dependency (own force-layout.ts, no tile server).
 */
export function TopologyPage() {
  const rawSearch = useSearch({ strict: false }) as Record<string, unknown>;
  const search = validateTopologySearch(rawSearch);
  const navigate = useNavigate();
  const view = search.view ?? "graph";

  const { graph, hosts, isLoading, problemsByHost } = useTopology();
  const hostByHostId = useMemo(() => new Map(hosts.map((h) => [h.hostid, h])), [hosts]);
  const [layers, setLayers] = useState<Record<LayerKey, boolean>>({ explicit: true, l3: true, logical: true });
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();

  function setView(next: "graph" | "map") {
    void navigate({ to: "/topology", search: (prev) => ({ ...prev, view: next === "map" ? "map" : undefined }) });
  }

  const reduced = useMemo(
    () => reduceForLargeGraphs(graph.nodes, graph.edges, showAll),
    [graph.nodes, graph.edges, showAll],
  );

  const layerFilteredEdges = useMemo(
    () => reduced.edges.filter((e) => layers[e.level]),
    [reduced.edges, layers],
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
    () => reduced.nodes.filter((n) => n.kind === "host" || idsWithVisibleEdge.has(n.id)),
    [reduced.nodes, idsWithVisibleEdge],
  );

  const hostCountTotal = graph.nodes.filter((n) => n.kind === "host").length;
  const isLargeGraph = hostCountTotal > MAX_INITIAL_HOSTS && !showAll;

  const selectedNode = visibleNodes.find((n) => n.id === selectedNodeId);
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
            <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
              {view === "graph" &&
                LAYER_ORDER.map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setLayers((prev) => ({ ...prev, [key]: !prev[key] }))}
                    className={`rounded-full border px-2.5 py-1 text-[11.5px] ${
                      layers[key]
                        ? "border-accent/40 bg-accent-soft font-semibold text-accent"
                        : "border-line text-ink-2"
                    }`}
                  >
                    {LAYER_LABEL[key]}
                  </button>
                ))}
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Host suchen…"
                className="min-w-[160px] rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-ink"
              />
              {isLargeGraph && (
                <button
                  type="button"
                  onClick={() => setShowAll(true)}
                  className="ml-auto rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[11.5px] text-ink-2"
                >
                  Nur Probleme + Nachbarn ({visibleNodes.filter((n) => n.kind === "host").length} von{" "}
                  {hostCountTotal}) — alle anzeigen
                </button>
              )}
            </div>
            <div className="relative">
              {view === "graph" ? (
                <GraphCanvas
                  nodes={visibleNodes}
                  edges={layerFilteredEdges}
                  query={query}
                  selectedNodeId={selectedNodeId}
                  onSelect={setSelectedNodeId}
                />
              ) : (
                <GeoMapCanvas
                  hostNodes={reduced.nodes.filter((n) => n.kind === "host")}
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
                <LegendLine label="Maps (explizit)" dash={undefined} />
                <LegendLine label="L3-Subnetz (mittel)" dash="6 4" />
                <LegendLine label="Proxy (mittel)" dash="2 3" />
                <div className="mt-1 text-[11px] text-ink-muted">
                  Knotenfarbe = schwerstes aktives Problem. Positionen persistiert — Layout springt nie.
                </div>
              </div>
            </div>

            {selectedNode && (
              <div className="rounded-lg border border-line bg-surface p-3">
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
                        className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-ink-2"
                      >
                        Deep-Dive
                      </Link>
                      <Link
                        to="/"
                        search={{ host: selectedNode.hostid! }}
                        className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-[12px] text-ink-2"
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

function LegendLine({ label, dash }: { label: string; dash: string | undefined }) {
  return (
    <div className="flex items-center gap-2">
      <svg width="24" height="8" className="flex-none">
        <line
          x1="0"
          y1="4"
          x2="24"
          y2="4"
          stroke="var(--color-line)"
          strokeWidth="1.6"
          strokeDasharray={dash}
        />
      </svg>
      {label}
    </div>
  );
}

/** Shared pan/zoom mechanics for an SVG canvas keyed by a viewBox in component state. */
function usePanZoom(initial: ViewBox) {
  const [viewBox, setViewBox] = useState<ViewBox>(initial);
  const svgRef = useRef<SVGSVGElement>(null);
  const panRef = useRef<{ startX: number; startY: number; origin: ViewBox } | null>(null);

  function screenToUnits(dxPx: number, dyPx: number): { dx: number; dy: number } {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { dx: 0, dy: 0 };
    return { dx: (dxPx / rect.width) * viewBox.w, dy: (dyPx / rect.height) * viewBox.h };
  }

  function onWheel(e: React.WheelEvent<SVGSVGElement>) {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    setViewBox((vb) => {
      const newW = Math.max(80, Math.min(6000, vb.w * factor));
      const newH = Math.max(60, Math.min(4500, vb.h * factor));
      // Keep the point under the cursor stable.
      const rect = svgRef.current?.getBoundingClientRect();
      const px = rect ? (e.clientX - rect.left) / rect.width : 0.5;
      const py = rect ? (e.clientY - rect.top) / rect.height : 0.5;
      const cx = vb.x + px * vb.w;
      const cy = vb.y + py * vb.h;
      return { x: cx - px * newW, y: cy - py * newH, w: newW, h: newH };
    });
  }

  function onBackgroundPointerDown(e: React.PointerEvent<SVGSVGElement>) {
    panRef.current = { startX: e.clientX, startY: e.clientY, origin: viewBox };
  }

  function onPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (!panRef.current) return;
    const { dx, dy } = screenToUnits(e.clientX - panRef.current.startX, e.clientY - panRef.current.startY);
    const origin = panRef.current.origin;
    setViewBox({ ...origin, x: origin.x - dx, y: origin.y - dy });
  }

  function onPointerUp() {
    panRef.current = null;
  }

  const scale = initial.w / viewBox.w;

  return { viewBox, svgRef, onWheel, onBackgroundPointerDown, onPointerMove, onPointerUp, screenToUnits, scale };
}

function GraphCanvas({
  nodes,
  edges,
  query,
  selectedNodeId,
  onSelect,
}: {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  query: string;
  selectedNodeId: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const nodeIdKey = useMemo(() => nodes.map((n) => n.id).sort().join(","), [nodes]);
  const [positions, setPositions] = useState<Positions>({});
  const dragRef = useRef<{ id: string } | null>(null);
  const { viewBox, svgRef, onWheel, onBackgroundPointerDown, onPointerMove, onPointerUp, scale } =
    usePanZoom(INITIAL_VIEWBOX);

  // Layout runs once per distinct node set (PLAN.md: "einmalig, dann statisch") —
  // seeded from persisted positions so it never re-jumps on reload.
  useEffect(() => {
    const stored = loadPositions();
    const layoutNodes = nodes.map((n) => ({ id: n.id, x: stored[n.id]?.x, y: stored[n.id]?.y }));
    const computed = computeForceLayout(layoutNodes, edges, {
      width: INITIAL_VIEWBOX.w,
      height: INITIAL_VIEWBOX.h,
    });
    const next: Positions = {};
    for (const [id, p] of computed) next[id] = p;
    setPositions(next);
    // Intentionally keyed on the node-id set only — layout runs once per
    // distinct node set (PLAN.md), not on every edges/nodes reference change.
  }, [nodeIdKey]);

  function onNodePointerDown(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    dragRef.current = { id };
  }

  function onSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (dragRef.current) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const ux = viewBox.x + ((e.clientX - rect.left) / rect.width) * viewBox.w;
      const uy = viewBox.y + ((e.clientY - rect.top) / rect.height) * viewBox.h;
      setPositions((prev) => ({ ...prev, [dragRef.current!.id]: { x: ux, y: uy } }));
      return;
    }
    onPointerMove(e);
  }

  function onSvgPointerUp() {
    if (dragRef.current) {
      savePositions(positions);
      dragRef.current = null;
      return;
    }
    onPointerUp();
  }

  const q = query.trim().toLowerCase();
  const showLabels = nodes.length <= LABEL_DENSE_CUTOFF || scale >= LABEL_ZOOM_THRESHOLD;

  return (
    <svg
      ref={svgRef}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      className="h-[560px] w-full touch-none select-none rounded-b-lg bg-surface-2"
      role="img"
      aria-label="Automatisch abgeleitete Topologie"
      onWheel={onWheel}
      onPointerDown={onBackgroundPointerDown}
      onPointerMove={onSvgPointerMove}
      onPointerUp={onSvgPointerUp}
      onPointerLeave={onSvgPointerUp}
    >
      {edges.map((e, i) => {
        const a = positions[e.source];
        const b = positions[e.target];
        if (!a || !b) return null;
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="var(--color-line)"
            strokeWidth={1.4}
            strokeDasharray={DASH_FOR_LEVEL[e.level]}
          />
        );
      })}
      {nodes.map((n) => {
        const p = positions[n.id];
        if (!p) return null;
        const matched = q.length > 0 && n.label.toLowerCase().includes(q);
        const dimmed = q.length > 0 && !matched;
        const isHost = n.kind === "host";
        const selected = n.id === selectedNodeId;
        return (
          <g
            key={n.id}
            transform={`translate(${p.x} ${p.y})`}
            opacity={dimmed ? 0.3 : 1}
            onPointerDown={(e) => onNodePointerDown(e, n.id)}
            onClick={(e) => {
              e.stopPropagation();
              onSelect(n.id);
            }}
            style={{ cursor: "pointer" }}
          >
            {isHost ? (
              <circle
                r={selected ? 9 : 7}
                fill={severityNodeColor(n)}
                stroke={selected || matched ? "var(--color-accent)" : "var(--color-surface)"}
                strokeWidth={selected ? 2.5 : 1.5}
              />
            ) : n.kind === "subnet" ? (
              <rect
                x={-6}
                y={-6}
                width={12}
                height={12}
                fill="var(--color-surface-3)"
                stroke="var(--color-line)"
                strokeWidth={1.2}
              />
            ) : (
              <rect
                x={-6}
                y={-6}
                width={12}
                height={12}
                fill="var(--color-surface-3)"
                stroke="var(--color-line)"
                strokeWidth={1.2}
                transform="rotate(45)"
              />
            )}
            {showLabels && (
              <text
                y={isHost ? 18 : 16}
                textAnchor="middle"
                fontSize={9}
                fill="var(--color-ink-2)"
                style={{ pointerEvents: "none" }}
              >
                {n.label.length > 20 ? `${n.label.slice(0, 19)}…` : n.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

interface GeoHost {
  id: string;
  label: string;
  lat: number;
  lon: number;
  severity: TopologyNode["severity"];
}

function GeoMapCanvas({
  hostNodes,
  hostByHostId,
  query,
  selectedNodeId,
  onSelect,
}: {
  hostNodes: TopologyNode[];
  hostByHostId: Map<string, ZabbixHost>;
  query: string;
  selectedNodeId: string | undefined;
  onSelect: (id: string | undefined) => void;
}) {
  const located: GeoHost[] = useMemo(() => {
    const out: GeoHost[] = [];
    for (const n of hostNodes) {
      const host = n.hostid ? hostByHostId.get(n.hostid) : undefined;
      const lat = Number(host?.inventory?.location_lat);
      const lon = Number(host?.inventory?.location_lon);
      if (host?.inventory?.location_lat && host?.inventory?.location_lon && Number.isFinite(lat) && Number.isFinite(lon)) {
        out.push({ id: n.id, label: n.label, lat, lon, severity: n.severity });
      }
    }
    return out;
  }, [hostNodes, hostByHostId]);

  const missingCount = hostNodes.length - located.length;

  const bounds = useMemo(() => {
    if (located.length === 0) return { minLat: -10, maxLat: 10, minLon: -10, maxLon: 10 };
    const lats = located.map((h) => h.lat);
    const lons = located.map((h) => h.lon);
    const pad = 2;
    return {
      minLat: Math.min(...lats) - pad,
      maxLat: Math.max(...lats) + pad,
      minLon: Math.min(...lons) - pad,
      maxLon: Math.max(...lons) + pad,
    };
  }, [located]);

  const initialViewBox: ViewBox = useMemo(
    () => ({
      x: bounds.minLon,
      y: -bounds.maxLat,
      w: Math.max(bounds.maxLon - bounds.minLon, 1),
      h: Math.max(bounds.maxLat - bounds.minLat, 1),
    }),
    [bounds],
  );

  const { viewBox, svgRef, onWheel, onBackgroundPointerDown, onPointerMove, onPointerUp, scale } =
    usePanZoom(initialViewBox);

  const q = query.trim().toLowerCase();
  const showLabels = located.length <= LABEL_DENSE_CUTOFF || scale >= LABEL_ZOOM_THRESHOLD;

  const gridLines: number[] = [];
  for (let lat = -80; lat <= 80; lat += 10) gridLines.push(lat);
  const gridLons: number[] = [];
  for (let lon = -180; lon <= 180; lon += 10) gridLons.push(lon);

  return (
    <div>
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="h-[560px] w-full touch-none select-none rounded-b-lg bg-surface-2"
        role="img"
        aria-label="Geomap aus Inventar-Koordinaten"
        onWheel={onWheel}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {gridLons.map((lon) => (
          <line key={`lon${lon}`} x1={lon} y1={-90} x2={lon} y2={90} stroke="var(--color-line-soft)" strokeWidth={0.05} />
        ))}
        {gridLines.map((lat) => (
          <line key={`lat${lat}`} x1={-180} y1={-lat} x2={180} y2={-lat} stroke="var(--color-line-soft)" strokeWidth={0.05} />
        ))}
        {located.map((h) => {
          const matched = q.length > 0 && h.label.toLowerCase().includes(q);
          const dimmed = q.length > 0 && !matched;
          const selected = h.id === selectedNodeId;
          const r = (selected ? 0.5 : 0.35) * Math.max(viewBox.w, viewBox.h) * 0.01;
          return (
            <g
              key={h.id}
              transform={`translate(${h.lon} ${-h.lat})`}
              opacity={dimmed ? 0.3 : 1}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(h.id);
              }}
              style={{ cursor: "pointer" }}
            >
              <circle
                r={Math.max(r, viewBox.w * 0.006)}
                fill={severityNodeColor({ kind: "host", severity: h.severity } as TopologyNode)}
                stroke={selected || matched ? "var(--color-accent)" : "var(--color-surface)"}
                strokeWidth={viewBox.w * 0.0015}
              />
              {showLabels && (
                <text
                  y={-viewBox.h * 0.02}
                  textAnchor="middle"
                  fontSize={viewBox.w * 0.012}
                  fill="var(--color-ink-2)"
                  style={{ pointerEvents: "none" }}
                >
                  {h.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="border-t border-line-soft px-3.5 py-2 font-mono text-[10.5px] text-ink-muted">
        {missingCount} Hosts ohne Koordinaten
      </div>
    </div>
  );
}
