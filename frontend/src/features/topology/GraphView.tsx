import { useEffect, useMemo, useRef, useState } from "react";
import { computeForceLayout } from "../../lib/force-layout";
import { computeBounds } from "../../lib/geo";
import type { TopologyEdge, TopologyEdgeLevel, TopologyNode } from "../../lib/topology";
import { usePanZoom, type ViewBox } from "./use-pan-zoom";
import { ZoomControls } from "./ZoomControls";

const POSITIONS_KEY = "auzui-topology-positions";
const LABEL_ZOOM_THRESHOLD = 1.6;
/** Labels are shown unconditionally up to this many nodes — tuned so Fit on <=40 hosts already clears the zoom threshold. */
const LABEL_DENSE_CUTOFF = 40;
const HUB_LABEL_ZOOM_THRESHOLD = 2.4;
const INITIAL_VIEWBOX: ViewBox = { x: 0, y: 0, w: 1000, h: 700 };
const PAN_ZOOM_OPTS = { minW: 80, maxW: 6000, minH: 60, maxH: 4500 };

const MIN_RADIUS_PX = 5;
const MAX_RADIUS_PX = 11;
const HUB_SIZE_PX = 7;

const DASH_FOR_LEVEL: Record<TopologyEdgeLevel, string | undefined> = {
  explicit: undefined,
  l3: "6 4",
  logical: "2 3",
};

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

function truncateLabel(label: string, max = 18): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/**
 * Force-directed auto-topology graph (PLAN.md "Graph-Design" + "Gemeinsame
 * Interaktion"). Layout runs once per distinct node-id set and persists to
 * localStorage so it never re-jumps; pan/zoom is shared with MapView via
 * use-pan-zoom.ts.
 */
export function GraphView({
  nodes,
  edges,
  query,
  selectedNodeId,
  onSelect,
  problemCountByHostId,
}: {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  query: string;
  selectedNodeId: string | undefined;
  onSelect: (id: string | undefined) => void;
  problemCountByHostId: Map<string, number>;
}) {
  const nodeIdKey = useMemo(() => nodes.map((n) => n.id).sort().join(","), [nodes]);
  const [positions, setPositions] = useState<Positions>({});
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | undefined>();
  const {
    viewBox,
    svgRef,
    onWheel,
    onDoubleClick,
    onBackgroundPointerDown,
    onPointerMove,
    onPointerUp,
    scale,
    zoomBy,
    fitTo,
  } = usePanZoom(INITIAL_VIEWBOX, PAN_ZOOM_OPTS);

  // Layout runs once per distinct node set (PLAN.md: "einmalig, dann statisch") —
  // seeded from persisted positions, clustered by hostgroup, so it never re-jumps on reload.
  useEffect(() => {
    const stored = loadPositions();
    const layoutNodes = nodes.map((n) => ({
      id: n.id,
      x: stored[n.id]?.x,
      y: stored[n.id]?.y,
      group: n.kind === "host" ? n.groupKey : undefined,
    }));
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

  function fitToNodes() {
    const pts = nodes.map((n) => positions[n.id]).filter((p): p is { x: number; y: number } => Boolean(p));
    const bounds = computeBounds(pts);
    if (bounds) fitTo(bounds, 0.1, 40);
  }

  function onNodePointerDown(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    dragRef.current = { id, moved: false };
  }

  function onSvgPointerMove(e: React.PointerEvent<SVGSVGElement>) {
    if (dragRef.current) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragRef.current.moved = true;
      const ux = viewBox.x + ((e.clientX - rect.left) / rect.width) * viewBox.w;
      const uy = viewBox.y + ((e.clientY - rect.top) / rect.height) * viewBox.h;
      setPositions((prev) => ({ ...prev, [dragRef.current!.id]: { x: ux, y: uy } }));
      return;
    }
    onPointerMove(e);
  }

  function onSvgPointerUp(e: React.PointerEvent<SVGSVGElement>) {
    if (dragRef.current) {
      savePositions(positions);
      dragRef.current = null;
      return;
    }
    onPointerUp(e);
  }

  const q = query.trim().toLowerCase();
  const showLabels = nodes.length <= LABEL_DENSE_CUTOFF || scale >= LABEL_ZOOM_THRESHOLD;
  const showHubLabels = nodes.length <= LABEL_DENSE_CUTOFF || scale >= HUB_LABEL_ZOOM_THRESHOLD;

  const neighborIds = useMemo(() => {
    if (!hoveredNodeId) return undefined;
    const s = new Set<string>();
    for (const e of edges) {
      if (e.source === hoveredNodeId) s.add(e.target);
      if (e.target === hoveredNodeId) s.add(e.source);
    }
    return s;
  }, [hoveredNodeId, edges]);

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="h-[560px] w-full cursor-grab touch-none select-none rounded-b-lg bg-surface-2 active:cursor-grabbing"
        role="img"
        aria-label="Automatisch abgeleitete Topologie"
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onSvgPointerMove}
        onPointerUp={onSvgPointerUp}
        onPointerLeave={onSvgPointerUp}
      >
        {edges.map((e, i) => {
          const a = positions[e.source];
          const b = positions[e.target];
          if (!a || !b) return null;
          const highlighted = hoveredNodeId && (e.source === hoveredNodeId || e.target === hoveredNodeId);
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={highlighted ? "var(--color-accent)" : "var(--color-line)"}
              strokeOpacity={highlighted ? 0.9 : 0.5}
              strokeWidth={(highlighted ? 2.2 : 1.4) / scale}
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
          const hovered = n.id === hoveredNodeId;
          const isNeighborOfHover = neighborIds?.has(n.id) ?? false;
          const problemCount = n.hostid ? (problemCountByHostId.get(n.hostid) ?? 0) : 0;
          const radiusPx = isHost
            ? Math.min(MAX_RADIUS_PX, MIN_RADIUS_PX + Math.min(problemCount, 8) * 0.8)
            : HUB_SIZE_PX;
          const r = radiusPx / scale;
          const labelVisible = isHost ? showLabels : showHubLabels;
          return (
            <g
              key={n.id}
              transform={`translate(${p.x} ${p.y})`}
              opacity={dimmed ? 0.3 : 1}
              onPointerDown={(e) => onNodePointerDown(e, n.id)}
              onPointerEnter={() => setHoveredNodeId(n.id)}
              onPointerLeave={() => setHoveredNodeId((cur) => (cur === n.id ? undefined : cur))}
              onClick={(e) => {
                e.stopPropagation();
                if (!dragRef.current?.moved) onSelect(n.id);
              }}
              style={{ cursor: "pointer" }}
            >
              {isHost ? (
                <circle
                  r={r}
                  fill={severityNodeColor(n)}
                  stroke={
                    selected || hovered
                      ? "var(--color-accent)"
                      : matched || isNeighborOfHover
                        ? "var(--color-accent)"
                        : "var(--color-surface)"
                  }
                  strokeWidth={(selected || hovered ? 2.5 : 1.5) / scale}
                />
              ) : (
                <rect
                  x={-r}
                  y={-r}
                  width={r * 2}
                  height={r * 2}
                  fill="var(--color-surface-3)"
                  stroke={hovered || selected ? "var(--color-accent)" : "var(--color-ink-muted)"}
                  strokeWidth={1.2 / scale}
                  transform={n.kind === "proxy" ? "rotate(45)" : undefined}
                />
              )}
              {labelVisible && (
                <text
                  y={(isHost ? 18 : 16) / scale}
                  textAnchor="middle"
                  fontSize={9 / scale}
                  fill={isHost && n.severity !== undefined ? "var(--color-ink)" : "var(--color-ink-2)"}
                  stroke="var(--color-surface-2)"
                  strokeWidth={3 / scale}
                  paintOrder="stroke"
                  style={{ pointerEvents: "none" }}
                >
                  {truncateLabel(n.label)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <ZoomControls onZoomIn={() => zoomBy(1 / 1.4)} onZoomOut={() => zoomBy(1.4)} onFit={fitToNodes} />
    </div>
  );
}
