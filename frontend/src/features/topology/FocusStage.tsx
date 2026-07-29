import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ClusterHostRef, ClusterSummary } from "../../lib/topology";
import { computeRadialPositions, orderHostsForRadial, shouldCollapseOkHosts } from "../../lib/radial-layout";
import { severityDotColor, severityLabel } from "../../lib/severity";
import { usePanZoom, type ViewBox } from "./use-pan-zoom";
import { ZoomControls } from "./ZoomControls";
import { useLocale, useT } from "../../lib/i18n";

const RADIUS = 200;
const LABEL_RADIUS = RADIUS + 22;
const INITIAL_VIEWBOX: ViewBox = { x: -300, y: -300, w: 600, h: 600 };
const PAN_ZOOM_OPTS = { minW: 40, maxW: 2400, minH: 40, maxH: 2400 };
const HOST_R_PX = 7;
const HUB_R_PX = 11;

const OK_COLLAPSED_ID = "__ok_collapsed__";

interface TooltipState {
  x: number;
  y: number;
  host: ClusterHostRef;
}

function truncateLabel(label: string, max = 20): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/**
 * Fokus-Bühne für die L3-Subnetze- und Proxies-Tabs (PLAN.md "ruhiges
 * Radial-Layout ... deterministisch, kein Force-Zappeln"): Hub in der Mitte
 * = Subnetz/Proxy-Name, Hosts im Kreis darum, Winkel = Index/N,
 * Problem-Hosts zuerst im Uhrzeigersinn (lib/radial-layout.ts). Über
 * OK_COLLAPSE_THRESHOLD OK-Hosts werden zu einem Sammelknoten eingeklappt,
 * per Klick expandierbar.
 */
export function FocusStage({ cluster }: { cluster: ClusterSummary | undefined }) {
  const t = useT();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [expandedOk, setExpandedOk] = useState(false);
  const [tooltip, setTooltip] = useState<TooltipState | undefined>();
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

  // Collapse state resets whenever a different cluster is focused.
  useEffect(() => {
    setExpandedOk(false);
  }, [cluster?.id]);

  const ordered = useMemo(() => (cluster ? orderHostsForRadial(cluster.hosts.map((h) => ({ id: h.hostid, severity: h.severity }))) : []), [cluster]);
  const hostById = useMemo(() => new Map((cluster?.hosts ?? []).map((h) => [h.hostid, h])), [cluster]);

  const problems = ordered.filter((h) => h.severity !== undefined);
  const okHosts = ordered.filter((h) => h.severity === undefined);
  const collapse = !expandedOk && shouldCollapseOkHosts(okHosts.length);

  const circleIds = collapse ? [...problems.map((h) => h.id), OK_COLLAPSED_ID] : ordered.map((h) => h.id);
  const positions = useMemo(() => computeRadialPositions(circleIds, RADIUS), [circleIds]);

  function fitToCluster() {
    fitTo({ minX: -RADIUS - 40, maxX: RADIUS + 40, minY: -RADIUS - 40, maxY: RADIUS + 40 }, 0.05, 40);
  }

  function showTooltip(host: ClusterHostRef, clientX: number, clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({ host, x: clientX - rect.left, y: clientY - rect.top });
  }

  if (!cluster) {
    return <div className="flex h-[560px] items-center justify-center text-[13px] text-ink-muted">{t("topology.breadcrumb.empty")}</div>;
  }

  return (
    <div ref={containerRef} className="relative">
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="h-[560px] w-full cursor-grab touch-none select-none rounded-b-lg bg-surface-2 active:cursor-grabbing"
        role="img"
        aria-label={t("topology.graphAria")}
        onWheel={onWheel}
        onDoubleClick={onDoubleClick}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setTooltip(undefined)}
      >
        {/* Spokes */}
        {positions.map((p) => {
          const host = hostById.get(p.id);
          return (
            <line
              key={`spoke:${p.id}`}
              x1={0}
              y1={0}
              x2={p.x}
              y2={p.y}
              stroke="var(--color-line)"
              strokeOpacity={0.5}
              strokeWidth={1.2 / scale}
              onPointerEnter={(e) => host && showTooltip(host, e.clientX, e.clientY)}
              onPointerLeave={() => setTooltip(undefined)}
            />
          );
        })}

        {/* Hub */}
        <g>
          <circle r={HUB_R_PX / scale} fill="var(--color-surface-3)" stroke="var(--color-ink-muted)" strokeWidth={1.5 / scale} />
          <text
            y={-(HUB_R_PX + 10) / scale}
            textAnchor="middle"
            fontSize={11 / scale}
            fontWeight={700}
            fill="var(--color-ink)"
            stroke="var(--color-surface-2)"
            strokeWidth={3 / scale}
            paintOrder="stroke"
            style={{ pointerEvents: "none" }}
          >
            {truncateLabel(cluster.name, 28)}
          </text>
        </g>

        {/* Hosts (or the collapsed "+N OK" node) */}
        {positions.map((p) => {
          if (p.id === OK_COLLAPSED_ID) {
            return (
              <g
                key={p.id}
                transform={`translate(${p.x} ${p.y})`}
                onClick={(e) => {
                  e.stopPropagation();
                  setExpandedOk(true);
                }}
                style={{ cursor: "pointer" }}
              >
                <circle r={HOST_R_PX / scale} fill="var(--color-surface-3)" stroke="var(--color-ink-muted)" strokeWidth={1.5 / scale} />
                <text
                  y={16 / scale}
                  textAnchor="middle"
                  fontSize={9.5 / scale}
                  fill="var(--color-ink-2)"
                  stroke="var(--color-surface-2)"
                  strokeWidth={3 / scale}
                  paintOrder="stroke"
                  style={{ pointerEvents: "none" }}
                >
                  {t("topology.stage.okCollapsed", okHosts.length)}
                </text>
              </g>
            );
          }
          const host = hostById.get(p.id);
          if (!host) return null;
          return (
            <g
              key={p.id}
              transform={`translate(${p.x} ${p.y})`}
              onPointerEnter={(e) => showTooltip(host, e.clientX, e.clientY)}
              onPointerLeave={() => setTooltip(undefined)}
              onClick={(e) => {
                e.stopPropagation();
                void navigate({ to: "/hosts/$hostId", params: { hostId: host.hostid } });
              }}
              style={{ cursor: "pointer" }}
            >
              <circle
                r={HOST_R_PX / scale}
                fill={severityDotColor(host.severity)}
                stroke="var(--color-surface)"
                strokeWidth={1.5 / scale}
              />
              <text
                x={((LABEL_RADIUS - RADIUS) * Math.cos(p.angle)) / scale}
                y={((LABEL_RADIUS - RADIUS) * Math.sin(p.angle)) / scale}
                textAnchor="middle"
                fontSize={9 / scale}
                fill={host.severity !== undefined ? "var(--color-ink)" : "var(--color-ink-2)"}
                stroke="var(--color-surface-2)"
                strokeWidth={3 / scale}
                paintOrder="stroke"
                style={{ pointerEvents: "none" }}
              >
                {truncateLabel(host.label)}
              </text>
            </g>
          );
        })}
      </svg>

      {expandedOk && shouldCollapseOkHosts(okHosts.length) && (
        <button
          type="button"
          onClick={() => setExpandedOk(false)}
          className="absolute left-3 top-3 rounded-md border border-line bg-surface/90 px-2 py-1 text-[11px] text-ink-2 shadow-sm backdrop-blur hover:text-ink"
        >
          {t("topology.stage.collapseOk")}
        </button>
      )}

      <ZoomControls onZoomIn={() => zoomBy(1 / 1.4)} onZoomOut={() => zoomBy(1.4)} onFit={fitToCluster} />

      {tooltip && (
        <div
          className="pointer-events-none absolute z-10 max-w-[220px] rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-ink shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          <div className="font-semibold">{tooltip.host.label}</div>
          <div className="text-ink-2">{tooltip.host.ip ?? t("topology.stage.noIp")}</div>
          <div className="text-ink-2">
            {tooltip.host.severity !== undefined
              ? t("topology.stage.activeProblems", tooltip.host.problemCount, severityLabel(tooltip.host.severity, locale))
              : t("topology.stage.noActiveProblems")}
          </div>
          <div className="mt-1 text-ink-muted">{t("topology.stage.clickToHost")}</div>
        </div>
      )}
    </div>
  );
}
