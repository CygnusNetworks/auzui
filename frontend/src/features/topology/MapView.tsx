import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import type { ZabbixHost } from "@auzui/zabbix-client";
import land from "../../assets/world-land.json";
import { clusterByCoordinate, computeBounds, projectEquirectangular, type GeoCluster } from "../../lib/geo";
import type { TopologyNode } from "../../lib/topology";
import type { Severity } from "../../lib/severity";
import { usePanZoom, type ViewBox } from "./use-pan-zoom";
import { ZoomControls } from "./ZoomControls";
import { useT } from "../../lib/i18n";

const LAND: number[][][] = land as number[][][];
const PAN_ZOOM_OPTS = { minW: 0.5, maxW: 400, minH: 0.4, maxH: 300 };
const LABEL_ZOOM_THRESHOLD = 6;
const LABEL_DENSE_CUTOFF = 40;
/** Beyond this zoom, coordinates that are still merged into one cluster point can't be told apart by zooming further — clicking opens the host-list popover instead. */
const MAX_USEFUL_ZOOM = 60;
const WORLD_BOUNDS = { minX: -180, maxX: 180, minY: -85, maxY: 85 };

function severityNodeColor(severity: Severity | undefined): string {
  if (severity === undefined) return "var(--color-sev-ok)";
  const tokens: Record<number, string> = {
    5: "var(--color-sev-disaster)",
    4: "var(--color-sev-high)",
    3: "var(--color-sev-avg)",
    2: "var(--color-sev-warn)",
    1: "var(--color-sev-info)",
    0: "var(--color-ink-muted)",
  };
  return tokens[severity] ?? "var(--color-sev-ok)";
}

function worstSeverity(severities: (Severity | undefined)[]): Severity | undefined {
  let worst: Severity | undefined;
  for (const s of severities) if (s !== undefined && (worst === undefined || s > worst)) worst = s;
  return worst;
}

interface GeoHost {
  id: string;
  hostid: string;
  label: string;
  lat: number;
  lon: number;
  severity: Severity | undefined;
}

/**
 * Geomap-Ansicht: world-land.json als Kulisse (rein dekorativ, dient nur der
 * Orientierung — die Ansicht fittet immer auf die Host-Bounding-Box, siehe
 * PLAN.md "Fit auf die Host-Bounding-Box"), Hosts als Punkte geclustert nach
 * identischen Koordinaten.
 */
export function MapView({
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
  const t = useT();
  const [activeClusterId, setActiveClusterId] = useState<string | undefined>();
  const [showMissingList, setShowMissingList] = useState(false);

  const { located, missing } = useMemo(() => {
    const loc: GeoHost[] = [];
    const miss: TopologyNode[] = [];
    for (const n of hostNodes) {
      const host = n.hostid ? hostByHostId.get(n.hostid) : undefined;
      const lat = Number(host?.inventory?.location_lat);
      const lon = Number(host?.inventory?.location_lon);
      if (host?.inventory?.location_lat && host?.inventory?.location_lon && Number.isFinite(lat) && Number.isFinite(lon)) {
        loc.push({ id: n.id, hostid: n.hostid!, label: n.label, lat, lon, severity: n.severity });
      } else {
        miss.push(n);
      }
    }
    return { located: loc, missing: miss };
  }, [hostNodes, hostByHostId]);

  const hostById = useMemo(() => new Map(located.map((h) => [h.id, h])), [located]);

  const clusters: GeoCluster[] = useMemo(() => clusterByCoordinate(located), [located]);

  const landPaths = useMemo(
    () =>
      LAND.map((polygon) =>
        polygon
          .map(([lon, lat], i) => {
            const p = projectEquirectangular(lat!, lon!);
            return `${i === 0 ? "M" : "L"}${p.x},${p.y}`;
          })
          .join(" ") + "Z",
      ),
    [],
  );

  const initialViewBox: ViewBox = useMemo(() => {
    const projected = located.map((h) => projectEquirectangular(h.lat, h.lon));
    const bounds = computeBounds(projected);
    if (!bounds) return { x: WORLD_BOUNDS.minX, y: -WORLD_BOUNDS.maxY, w: 360, h: 170 };
    const rawW = Math.max(bounds.maxX - bounds.minX, 4);
    const rawH = Math.max(bounds.maxY - bounds.minY, 4);
    const padW = rawW * 0.1;
    const padH = rawH * 0.1;
    return { x: bounds.minX - padW, y: bounds.minY - padH, w: rawW + padW * 2, h: rawH + padH * 2 };
  }, [located]);

  const { viewBox, svgRef, onWheel, onDoubleClick, onBackgroundPointerDown, onPointerMove, onPointerUp, scale, zoomBy, fitTo } =
    usePanZoom(initialViewBox, PAN_ZOOM_OPTS);

  const q = query.trim().toLowerCase();
  const showLabels = clusters.length <= LABEL_DENSE_CUTOFF || scale >= LABEL_ZOOM_THRESHOLD;

  function fitToHosts() {
    const projected = located.map((h) => projectEquirectangular(h.lat, h.lon));
    const bounds = computeBounds(projected);
    if (bounds) fitTo(bounds, 0.1, 4);
  }

  function onClusterClick(cluster: GeoCluster) {
    if (cluster.ids.length === 1) {
      onSelect(cluster.ids[0]);
      return;
    }
    if (scale >= MAX_USEFUL_ZOOM) {
      setActiveClusterId((cur) => (cur === cluster.id ? undefined : cluster.id));
      return;
    }
    const p = projectEquirectangular(cluster.lat, cluster.lon);
    fitTo({ minX: p.x - 0.5, maxX: p.x + 0.5, minY: p.y - 0.5, maxY: p.y + 0.5 }, 1, 0.5);
  }

  const activeCluster = clusters.find((c) => c.id === activeClusterId);

  return (
    <div>
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
          className="h-[560px] w-full cursor-grab touch-none select-none overflow-hidden rounded-b-lg bg-surface-2 active:cursor-grabbing"
          role="img"
          aria-label={t("topology.mapAria")}
          onWheel={onWheel}
          onDoubleClick={onDoubleClick}
          onPointerDown={onBackgroundPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={onPointerUp}
        >
          {landPaths.map((d, i) => (
            <path key={i} d={d} fill="var(--color-map-land)" stroke="var(--color-line-soft)" strokeWidth={0.3 / scale} />
          ))}
          {clusters.map((cluster) => {
            const members = cluster.ids.map((id) => hostById.get(id)!);
            const severity = worstSeverity(members.map((m) => m.severity));
            const label = members.length === 1 ? members[0]!.label : `${members.length} Hosts`;
            const matched = q.length > 0 && members.some((m) => m.label.toLowerCase().includes(q));
            const dimmed = q.length > 0 && !matched;
            const selected = selectedNodeId !== undefined && cluster.ids.includes(selectedNodeId);
            const p = projectEquirectangular(cluster.lat, cluster.lon);
            const basePx = members.length > 1 ? 7 : 5;
            const r = basePx / scale;
            return (
              <g
                key={cluster.id}
                transform={`translate(${p.x} ${p.y})`}
                opacity={dimmed ? 0.3 : 1}
                onClick={(e) => {
                  e.stopPropagation();
                  onClusterClick(cluster);
                }}
                style={{ cursor: "pointer" }}
              >
                <circle
                  r={r}
                  fill={severityNodeColor(severity)}
                  stroke={selected || matched ? "var(--color-accent)" : "var(--color-surface)"}
                  strokeWidth={(selected ? 2.5 : 1.5) / scale}
                />
                {members.length > 1 && (
                  <text
                    y={2.5 / scale}
                    textAnchor="middle"
                    fontSize={6.5 / scale}
                    fontWeight={700}
                    fill="var(--color-accent-ink)"
                    style={{ pointerEvents: "none" }}
                  >
                    {members.length}
                  </text>
                )}
                {showLabels && (
                  <text
                    y={16 / scale}
                    textAnchor="middle"
                    fontSize={9 / scale}
                    fill="var(--color-ink-2)"
                    stroke="var(--color-surface-2)"
                    strokeWidth={3 / scale}
                    paintOrder="stroke"
                    style={{ pointerEvents: "none" }}
                  >
                    {label.length > 18 ? `${label.slice(0, 17)}…` : label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
        <ZoomControls onZoomIn={() => zoomBy(1 / 1.4)} onZoomOut={() => zoomBy(1.4)} onFit={fitToHosts} />

        {activeCluster && (
          <div className="absolute left-3 top-3 max-h-[70%] w-56 overflow-y-auto rounded-lg border border-line bg-surface p-2.5 text-[12px] shadow-lg">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                {activeCluster.ids.length} Hosts am Standort
              </span>
              <button type="button" onClick={() => setActiveClusterId(undefined)} className="text-ink-muted">
                ✕
              </button>
            </div>
            <div className="flex flex-col gap-1">
              {activeCluster.ids.map((id) => {
                const h = hostById.get(id)!;
                return (
                  <Link
                    key={id}
                    to="/hosts/$hostId"
                    params={{ hostId: h.hostid }}
                    className="truncate rounded px-1.5 py-1 text-ink-2 hover:bg-surface-2 hover:text-ink"
                  >
                    {h.label}
                  </Link>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 border-t border-line-soft px-3.5 py-2 font-mono text-[10.5px] text-ink-muted">
        <button type="button" onClick={() => setShowMissingList((v) => !v)} className="hover:text-ink-2">
          {missing.length} Hosts ohne Koordinaten
        </button>
      </div>
      {showMissingList && missing.length > 0 && (
        <div className="max-h-40 overflow-y-auto border-t border-line-soft px-3.5 py-2">
          <div className="flex flex-col gap-0.5">
            {missing.map((n) => (
              <Link
                key={n.id}
                to="/hosts/$hostId"
                params={{ hostId: n.hostid! }}
                className="truncate rounded px-1.5 py-1 text-[12px] text-ink-2 hover:bg-surface-2 hover:text-ink"
              >
                {n.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
