import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ZabbixHost, ZabbixMap } from "@auzui/zabbix-client";
import type { HostProblemSummary } from "../../lib/hosts";
import { severityDotColor, severityLabel } from "../../lib/severity";
import { computeBounds } from "../../lib/geo";
import { usePanZoom, type ViewBox } from "./use-pan-zoom";
import { ZoomControls } from "./ZoomControls";
import { useLocale, useT } from "../../lib/i18n";

const NODE_R_PX = 8;
const PAN_ZOOM_OPTS = { minW: 40, maxW: 4000, minH: 40, maxH: 3000 };

interface TooltipState {
  x: number;
  y: number;
  hostid: string | undefined;
  label: string;
}

/**
 * Zabbix-Maps-Tab's focus stage: renders the selected map with its own
 * selement x/y positions and links, unlike the L3/Proxy tabs which use the
 * deterministic radial layout — PLAN.md: "Beim Tab 'Zabbix-Maps' rendert die
 * Bühne die gewählte Map mit ihren echten selement-Positionen und Links
 * (Kanten), Labels dran."
 */
export function MapStage({
  map,
  hostByHostId,
  problemsByHost,
}: {
  map: ZabbixMap | undefined;
  hostByHostId: Map<string, ZabbixHost>;
  problemsByHost: Map<string, HostProblemSummary>;
}) {
  const t = useT();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const [tooltip, setTooltip] = useState<TooltipState | undefined>();

  const points = useMemo(
    () =>
      (map?.selements ?? []).map((el) => ({
        selementid: el.selementid,
        x: Number(el.x),
        y: Number(el.y),
        label: el.label,
        hostid: el.elementtype === "0" ? el.elements?.[0]?.hostid : undefined,
      })),
    [map],
  );
  const pointBySelementId = useMemo(() => new Map(points.map((p) => [p.selementid, p])), [points]);

  const initialViewBox: ViewBox = useMemo(() => {
    const width = Number(map?.width ?? 800);
    const height = Number(map?.height ?? 600);
    return { x: 0, y: 0, w: width || 800, h: height || 600 };
  }, [map]);

  const { viewBox, svgRef, onWheel, onDoubleClick, onBackgroundPointerDown, onPointerMove, onPointerUp, scale, zoomBy, fitTo } =
    usePanZoom(initialViewBox, PAN_ZOOM_OPTS);

  function fitToMap() {
    const bounds = computeBounds(points.map((p) => ({ x: p.x, y: p.y })));
    if (bounds) fitTo(bounds, 0.12, 40);
  }

  function showTooltip(clientX: number, clientY: number, hostid: string | undefined, label: string) {
    setTooltip({ x: clientX, y: clientY, hostid, label });
  }

  if (!map) {
    return <div className="flex h-[560px] items-center justify-center text-[13px] text-ink-muted">{t("topology.breadcrumb.empty")}</div>;
  }

  if (points.length === 0) {
    return <div className="flex h-[560px] items-center justify-center text-[13px] text-ink-muted">{t("topology.stage.emptyMap")}</div>;
  }

  return (
    <div className="relative">
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
        {(map.links ?? []).map((link) => {
          const a = pointBySelementId.get(link.selementid1);
          const b = pointBySelementId.get(link.selementid2);
          if (!a || !b) return null;
          return (
            <line
              key={link.linkid}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--color-line)"
              strokeOpacity={0.6}
              strokeWidth={1.4 / scale}
              onPointerEnter={(e) => showTooltip(e.clientX, e.clientY, undefined, `${a.label} ↔ ${b.label}`)}
              onPointerLeave={() => setTooltip(undefined)}
            />
          );
        })}
        {points.map((p) => {
          const host = p.hostid ? hostByHostId.get(p.hostid) : undefined;
          const summary = p.hostid ? problemsByHost.get(p.hostid) : undefined;
          const severity = summary?.maxSeverity;
          return (
            <g
              key={p.selementid}
              transform={`translate(${p.x} ${p.y})`}
              onPointerEnter={(e) => showTooltip(e.clientX, e.clientY, p.hostid, p.label)}
              onPointerLeave={() => setTooltip(undefined)}
              onClick={(e) => {
                e.stopPropagation();
                if (p.hostid) void navigate({ to: "/hosts/$hostId", params: { hostId: p.hostid } });
              }}
              style={{ cursor: p.hostid ? "pointer" : "default" }}
            >
              <circle
                r={NODE_R_PX / scale}
                fill={host ? severityDotColor(severity) : "var(--color-surface-3)"}
                stroke="var(--color-surface)"
                strokeWidth={1.5 / scale}
              />
              <text
                y={18 / scale}
                textAnchor="middle"
                fontSize={9.5 / scale}
                fill="var(--color-ink-2)"
                stroke="var(--color-surface-2)"
                strokeWidth={3 / scale}
                paintOrder="stroke"
                style={{ pointerEvents: "none" }}
              >
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
      <ZoomControls onZoomIn={() => zoomBy(1 / 1.4)} onZoomOut={() => zoomBy(1.4)} onFit={fitToMap} />
      {tooltip && (
        <div
          className="pointer-events-none fixed z-10 max-w-[220px] rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-ink shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          <div className="font-semibold">{tooltip.label}</div>
          {tooltip.hostid &&
            (() => {
              const host = hostByHostId.get(tooltip.hostid);
              const summary = problemsByHost.get(tooltip.hostid);
              return (
                <>
                  <div className="text-ink-2">{host?.interfaces?.[0]?.ip ?? t("topology.stage.noIp")}</div>
                  <div className="text-ink-2">
                    {summary
                      ? t("topology.stage.activeProblems", summary.count, severityLabel(summary.maxSeverity, locale))
                      : t("topology.stage.noActiveProblems")}
                  </div>
                  <div className="mt-1 text-ink-muted">{t("topology.stage.clickToHost")}</div>
                </>
              );
            })()}
        </div>
      )}
    </div>
  );
}
