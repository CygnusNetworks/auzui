import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { ClusterHostRef, ClusterSummary } from "../../lib/topology";
import {
  buildSemanticRing,
  computeRadialPositions,
  deriveNameFamilies,
  detailLevelForZoom,
  labelRadiusOffset,
  metaNodeRadius,
  MISC_FAMILY_KEY,
  OK_COLLAPSE_THRESHOLD,
  orderHostsForRadial,
  radialRadius,
  representedProblemCount,
  representedWorstSeverity,
  severityDistribution,
  shouldCollapseOkHosts,
  shouldRenderLabel,
  type FamilyMemberHost,
  type NameFamily,
} from "../../lib/radial-layout";
import { severityDotColor, severityLabel } from "../../lib/severity";
import { fitViewBox, type Bounds } from "../../lib/geo";
import { usePanZoom, zoomBoundsFromFit, type ViewBox } from "./use-pan-zoom";
import { ZoomControls } from "./ZoomControls";
import { useLocale, useT } from "../../lib/i18n";

const INITIAL_VIEWBOX: ViewBox = { x: -300, y: -300, w: 600, h: 600 };
/** Padding (world units) added around the outermost node ring when fitting the stage. */
const STAGE_PADDING = 48;
const HOST_R_PX = 7;
const HUB_R_PX = 11;
/**
 * Above this many hosts a cluster switches to the "semantic zoom" layout
 * (name-family meta-nodes + zoom-coupled detail) instead of the flat
 * individual-dots-with-OK-collapse layout. The threshold mirrors the OK-collapse
 * threshold: below it a cluster is small enough to show every host at once.
 */
const SEMANTIC_MIN_HOSTS = OK_COLLAPSE_THRESHOLD;

/** Square bounds enclosing a radial ring of `radius` plus label/marker padding. */
function ringBounds(radius: number): Bounds {
  const half = radius + STAGE_PADDING;
  return { minX: -half, maxX: half, minY: -half, maxY: half };
}

/** Bounds centered on a family's meta position, sized to land the zoom comfortably in detail-level 2. */
function familyZoomBounds(cx: number, cy: number, fitW: number): Bounds {
  const half = fitW / 2.4 / 2; // ~2.4× fit → clearly past the level-2 threshold (1.6×)
  return { minX: cx - half, maxX: cx + half, minY: cy - half, maxY: cy + half };
}

const OK_COLLAPSED_ID = "__ok_collapsed__";

type TooltipState =
  | { kind: "host"; x: number; y: number; host: ClusterHostRef }
  | { kind: "meta"; x: number; y: number; family: NameFamily; represented: FamilyMemberHost[] };

function truncateLabel(label: string, max = 20): string {
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

/** Reads prefers-reduced-motion (guarded for jsdom, where matchMedia is absent). */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/**
 * Fokus-Bühne für die L3-Subnetze- und Proxies-Tabs (PLAN.md "ruhiges
 * Radial-Layout ... deterministisch, kein Force-Zappeln"): Hub in der Mitte
 * = Subnetz/Proxy-Name, Hosts im Kreis darum, Winkel = Index/N,
 * Problem-Hosts zuerst im Uhrzeigersinn (lib/radial-layout.ts).
 *
 * Kleine Cluster (≤ SEMANTIC_MIN_HOSTS Hosts): jeder Host als Einzelpunkt, über
 * OK_COLLAPSE_THRESHOLD OK-Hosts zu einem "+N OK"-Sammelknoten eingeklappt.
 *
 * Große Cluster: "Semantisches Zoom" — Hosts werden nach Namensfamilie zu
 * Meta-Knoten gebündelt (deriveNameFamilies), der Detailgrad hängt am Zoom
 * (detailLevelForZoom): Ebene 1 nur Meta-Knoten + schwere Einzel-Hosts (≥
 * Average), Ebene 2 expandiert die fokussierte Familie, Ebene 3 alle. So bleibt
 * auch der problem-dominierte Riesen-Cluster „Direkt überwacht" lesbar, wo der
 * reine OK-Collapse nicht greift.
 */
export function FocusStage({ cluster }: { cluster: ClusterSummary | undefined }) {
  const t = useT();
  const { locale } = useLocale();
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [expandedOk, setExpandedOk] = useState(false);
  const [focusedFamily, setFocusedFamily] = useState<string | undefined>();
  const [tooltip, setTooltip] = useState<TooltipState | undefined>();

  const ordered = useMemo(
    () => (cluster ? orderHostsForRadial(cluster.hosts.map((h) => ({ id: h.hostid, severity: h.severity }))) : []),
    [cluster],
  );
  const hostById = useMemo(() => new Map((cluster?.hosts ?? []).map((h) => [h.hostid, h])), [cluster]);

  // Semantic zoom applies to large clusters — but only when name families
  // actually bundle something (≥ 2 families). A large cluster of all-unique,
  // unrelated names would collapse to a single "Sonstige" meta-node, so there
  // we fall back to the flat layout + OK-collapse instead.
  const largeEnough = ordered.length > SEMANTIC_MIN_HOSTS;
  const families = useMemo(
    () =>
      largeEnough
        ? deriveNameFamilies((cluster?.hosts ?? []).map((h) => ({ id: h.hostid, label: h.label, severity: h.severity })))
        : [],
    [cluster, largeEnough],
  );
  const semantic = largeEnough && families.length >= 2;
  const familyByKey = useMemo(() => new Map(families.map((f) => [f.key, f])), [families]);
  const ringEntries = useMemo(() => (semantic ? buildSemanticRing(families) : []), [families, semantic]);

  // --- Flat layout (small clusters) --------------------------------------
  const problems = ordered.filter((h) => h.severity !== undefined);
  const okHosts = ordered.filter((h) => h.severity === undefined);
  const collapse = !semantic && !expandedOk && shouldCollapseOkHosts(okHosts.length);

  const circleIds = semantic
    ? ringEntries.map((e) => e.id)
    : collapse
      ? [...problems.map((h) => h.id), OK_COLLAPSED_ID]
      : ordered.map((h) => h.id);

  // Radius grows with the node count so big clusters get a bigger ring instead
  // of overlapping dots on a fixed circle (radial-layout.ts).
  const radius = radialRadius(circleIds.length);
  const positions = useMemo(() => computeRadialPositions(circleIds, radius), [circleIds, radius]);

  // Zoom is clamped to [0.5×, 8×] of the fit scale (use-pan-zoom.ts); the fit
  // span follows the (node-count-driven) radius, so the clamp adapts per cluster.
  const fitBox = useMemo(() => fitViewBox(ringBounds(radius), 0.05, 40), [radius]);
  const zoomOpts = useMemo(() => zoomBoundsFromFit(fitBox.w, fitBox.h), [fitBox.w, fitBox.h]);

  const { viewBox, svgRef, onWheel, onBackgroundPointerDown, onPointerMove, onPointerUp, scale, unitsPerPx, zoomBy, fitTo } =
    usePanZoom(INITIAL_VIEWBOX, zoomOpts);

  // Detail level (semantic mode) from the current zoom relative to the fit scale.
  const fitScale = INITIAL_VIEWBOX.w / fitBox.w;
  const relZoom = fitScale > 0 ? scale / fitScale : 1;
  const level = detailLevelForZoom(scale, fitScale);

  function fitToCluster() {
    fitTo(ringBounds(radius), 0.05, 40);
  }

  function focusFamily(key: string, cx: number, cy: number) {
    setFocusedFamily(key);
    fitTo(familyZoomBounds(cx, cy, fitBox.w), 0.05, 40);
  }

  function resetToOverview() {
    setFocusedFamily(undefined);
    fitToCluster();
  }

  // Reset collapse/focus state AND re-fit the view whenever a different cluster
  // is focused (a bigger cluster's larger ring would otherwise start off-screen).
  useEffect(() => {
    setExpandedOk(false);
    setFocusedFamily(undefined);
    fitToCluster();
  }, [cluster?.id]);

  function showHostTooltip(host: ClusterHostRef, clientX: number, clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({ kind: "host", host, x: clientX - rect.left, y: clientY - rect.top });
  }

  function showMetaTooltip(family: NameFamily, represented: FamilyMemberHost[], clientX: number, clientY: number) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({ kind: "meta", family, represented, x: clientX - rect.left, y: clientY - rect.top });
  }

  const nodeTransition = reducedMotion ? undefined : "transform 250ms ease";

  if (!cluster) {
    return <div className="flex h-[560px] items-center justify-center text-[13px] text-ink-muted">{t("topology.breadcrumb.empty")}</div>;
  }

  const familyLabel = (family: NameFamily) => (family.key === MISC_FAMILY_KEY ? t("topology.stage.miscFamily") : family.label);
  const focused = focusedFamily ? familyByKey.get(focusedFamily) : undefined;

  return (
    <div ref={containerRef} className="relative">
      <svg
        ref={svgRef}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        className="h-[560px] w-full cursor-grab touch-none select-none rounded-b-lg bg-surface-2 active:cursor-grabbing"
        role="img"
        aria-label={t("topology.graphAria")}
        onWheel={onWheel}
        onDoubleClick={fitToCluster}
        onPointerDown={onBackgroundPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setTooltip(undefined)}
      >
        {/* Spokes */}
        {positions.map((p) => (
          <line
            key={`spoke:${p.id}`}
            x1={0}
            y1={0}
            x2={p.x}
            y2={p.y}
            stroke="var(--color-line)"
            strokeOpacity={0.5}
            strokeWidth={1.2 * unitsPerPx}
            style={{ pointerEvents: "none" }}
          />
        ))}

        {/* Hub */}
        <g>
          <circle r={HUB_R_PX * unitsPerPx} fill="var(--color-surface-3)" stroke="var(--color-ink-muted)" strokeWidth={1.5 * unitsPerPx} />
          <text
            y={-(HUB_R_PX + 10) * unitsPerPx}
            textAnchor="middle"
            fontSize={11 * unitsPerPx}
            fontWeight={700}
            fill="var(--color-ink)"
            stroke="var(--color-surface-2)"
            strokeWidth={3 * unitsPerPx}
            paintOrder="stroke"
            style={{ pointerEvents: "none" }}
          >
            {truncateLabel(cluster.name, 28)}
          </text>
        </g>

        {semantic
          ? ringEntries.map((entry, i) => {
              const p = positions[i]!;
              if (entry.kind === "host") {
                const host = hostById.get(entry.id);
                if (!host) return null;
                return (
                  <HostNode
                    key={entry.id}
                    x={p.x}
                    y={p.y}
                    angle={p.angle}
                    index={i}
                    r={HOST_R_PX * unitsPerPx}
                    unitsPerPx={unitsPerPx}
                    label={truncateLabel(host.label)}
                    color={severityDotColor(host.severity)}
                    isProblem
                    showLabel
                    transition={nodeTransition}
                    onEnter={(e) => showHostTooltip(host, e.clientX, e.clientY)}
                    onLeave={() => setTooltip(undefined)}
                    onClick={() => void navigate({ to: "/hosts/$hostId", params: { hostId: host.hostid } })}
                  />
                );
              }

              const family = entry.family!;
              const represented = entry.represented!;
              // A focused family expands right away (one click → zoom + expand,
              // not gated on the zoom animation finishing); level 3 expands all.
              const expanded = level === 3 || focusedFamily === family.key;

              if (expanded) {
                const members = [...represented].sort((a, b) => (b.severity ?? 0) - (a.severity ?? 0));
                const subRadius = radialRadius(members.length);
                const sub = computeRadialPositions(
                  members.map((m) => m.id),
                  subRadius,
                );
                return (
                  <g key={entry.id} transform={`translate(${p.x} ${p.y})`} style={{ transition: nodeTransition }}>
                    {sub.map((sp, si) => {
                      const m = members[si]!;
                      const host = hostById.get(m.id);
                      const isProblem = m.severity !== undefined;
                      const showLabel =
                        level === 3 ||
                        shouldRenderLabel({
                          visibleCount: members.length,
                          hasProblem: isProblem,
                          isHovered: tooltip?.kind === "host" && tooltip.host.hostid === m.id,
                        });
                      return (
                        <HostNode
                          key={m.id}
                          x={sp.x}
                          y={sp.y}
                          angle={sp.angle}
                          index={si}
                          r={HOST_R_PX * unitsPerPx}
                          unitsPerPx={unitsPerPx}
                          label={truncateLabel(m.label)}
                          color={severityDotColor(m.severity)}
                          isProblem={isProblem}
                          showLabel={showLabel}
                          transition={nodeTransition}
                          onEnter={(e) => host && showHostTooltip(host, e.clientX, e.clientY)}
                          onLeave={() => setTooltip(undefined)}
                          onClick={() => host && void navigate({ to: "/hosts/$hostId", params: { hostId: host.hostid } })}
                        />
                      );
                    })}
                  </g>
                );
              }

              const worst = representedWorstSeverity(represented);
              const problemCount = representedProblemCount(represented);
              const metaR = metaNodeRadius(represented.length) * unitsPerPx;
              return (
                <g
                  key={entry.id}
                  transform={`translate(${p.x} ${p.y})`}
                  onPointerEnter={(e) => showMetaTooltip(family, represented, e.clientX, e.clientY)}
                  onPointerLeave={() => setTooltip(undefined)}
                  onClick={(e) => {
                    e.stopPropagation();
                    focusFamily(family.key, p.x, p.y);
                  }}
                  style={{ cursor: "pointer", transition: nodeTransition }}
                >
                  {worst !== undefined && (
                    <circle r={metaR + 3 * unitsPerPx} fill="none" stroke={severityDotColor(worst)} strokeWidth={2.5 * unitsPerPx} />
                  )}
                  <circle r={metaR} fill="var(--color-sev-ok)" fillOpacity={0.28} stroke="var(--color-sev-ok)" strokeWidth={1.5 * unitsPerPx} />
                  {problemCount > 0 && (
                    <text
                      textAnchor="middle"
                      y={3.5 * unitsPerPx}
                      fontSize={9 * unitsPerPx}
                      fontWeight={700}
                      fill="var(--color-ink)"
                      style={{ pointerEvents: "none" }}
                    >
                      {problemCount}
                    </text>
                  )}
                  <text
                    y={(metaNodeRadius(represented.length) + 12) * unitsPerPx}
                    textAnchor="middle"
                    fontSize={9.5 * unitsPerPx}
                    fill="var(--color-ink-2)"
                    stroke="var(--color-surface-2)"
                    strokeWidth={3 * unitsPerPx}
                    paintOrder="stroke"
                    style={{ pointerEvents: "none" }}
                  >
                    {truncateLabel(familyLabel(family), 22)} ({family.hosts.length})
                  </text>
                </g>
              );
            })
          : positions.map((p, i) => {
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
                    <circle r={HOST_R_PX * unitsPerPx} fill="var(--color-surface-3)" stroke="var(--color-ink-muted)" strokeWidth={1.5 * unitsPerPx} />
                    <text
                      y={16 * unitsPerPx}
                      textAnchor="middle"
                      fontSize={9.5 * unitsPerPx}
                      fill="var(--color-ink-2)"
                      stroke="var(--color-surface-2)"
                      strokeWidth={3 * unitsPerPx}
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
                <HostNode
                  key={p.id}
                  x={p.x}
                  y={p.y}
                  angle={p.angle}
                  index={i}
                  r={HOST_R_PX * unitsPerPx}
                  unitsPerPx={unitsPerPx}
                  label={truncateLabel(host.label)}
                  color={severityDotColor(host.severity)}
                  isProblem={host.severity !== undefined}
                  showLabel={shouldRenderLabel({
                    visibleCount: positions.length,
                    hasProblem: host.severity !== undefined,
                    isHovered: tooltip?.kind === "host" && tooltip.host.hostid === host.hostid,
                  })}
                  onEnter={(e) => showHostTooltip(host, e.clientX, e.clientY)}
                  onLeave={() => setTooltip(undefined)}
                  onClick={() => void navigate({ to: "/hosts/$hostId", params: { hostId: host.hostid } })}
                />
              );
            })}
      </svg>

      {/* In-stage breadcrumb once a family is focused/expanded. */}
      {semantic && focused && (
        <div className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-md border border-line bg-surface/90 px-2 py-1 font-mono text-[11px] text-ink-2 shadow-sm backdrop-blur">
          <button type="button" onClick={resetToOverview} className="hover:text-ink" title={t("topology.zoom.fit")}>
            {truncateLabel(cluster.name, 22)}
          </button>
          <span aria-hidden>▸</span>
          <span className="text-ink">
            {truncateLabel(familyLabel(focused), 22)} ({focused.hosts.length})
          </span>
        </div>
      )}

      {!semantic && expandedOk && shouldCollapseOkHosts(okHosts.length) && (
        <button
          type="button"
          onClick={() => setExpandedOk(false)}
          className="absolute left-3 top-3 rounded-md border border-line bg-surface/90 px-2 py-1 text-[11px] text-ink-2 shadow-sm backdrop-blur hover:text-ink"
        >
          {t("topology.stage.collapseOk")}
        </button>
      )}

      <ZoomControls
        onZoomIn={() => zoomBy(1 / 1.4)}
        onZoomOut={() => zoomBy(1.4)}
        onFit={resetToOverview}
        zoomLabel={semantic ? `${relZoom.toFixed(1)}×` : undefined}
      />

      {tooltip?.kind === "host" && (
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

      {tooltip?.kind === "meta" && (
        <div
          className="pointer-events-none absolute z-10 max-w-[240px] rounded-md border border-line bg-surface px-2.5 py-1.5 text-[11.5px] text-ink shadow-lg"
          style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
        >
          <div className="font-semibold">{familyLabel(tooltip.family)}</div>
          <div className="text-ink-2">{t("topology.stage.familyHosts", tooltip.family.hosts.length)}</div>
          {(() => {
            const dist = severityDistribution(tooltip.represented);
            return (
              <div className="mt-0.5 text-ink-2">
                {dist.entries.map((e) => (
                  <div key={e.severity}>{t("topology.stage.sevCount", e.count, severityLabel(e.severity, locale))}</div>
                ))}
                {dist.okCount > 0 && <div>{t("topology.stage.familyOk", dist.okCount)}</div>}
              </div>
            );
          })()}
          <div className="mt-1 text-ink-muted">{t("topology.stage.clickToExpand")}</div>
        </div>
      )}
    </div>
  );
}

/** One host dot on the ring (or a family sub-ring) with an optional staggered outward label. */
function HostNode({
  x,
  y,
  angle,
  index,
  r,
  unitsPerPx,
  label,
  color,
  isProblem,
  showLabel,
  transition,
  onEnter,
  onLeave,
  onClick,
}: {
  x: number;
  y: number;
  angle: number;
  index: number;
  r: number;
  /** World units per rendered pixel (usePanZoom) — keeps dot outline and label at a constant on-screen size. */
  unitsPerPx: number;
  label: string;
  color: string;
  isProblem: boolean;
  showLabel: boolean;
  transition?: string;
  onEnter: (e: React.PointerEvent) => void;
  onLeave: () => void;
  onClick: () => void;
}) {
  return (
    <g
      transform={`translate(${x} ${y})`}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      style={{ cursor: "pointer", transition }}
    >
      <circle r={r} fill={color} stroke="var(--color-surface)" strokeWidth={1.5 * unitsPerPx} />
      {showLabel && (
        <text
          x={labelRadiusOffset(index) * Math.cos(angle) * unitsPerPx}
          y={labelRadiusOffset(index) * Math.sin(angle) * unitsPerPx}
          textAnchor="middle"
          fontSize={9 * unitsPerPx}
          fill={isProblem ? "var(--color-ink)" : "var(--color-ink-2)"}
          stroke="var(--color-surface-2)"
          strokeWidth={3 * unitsPerPx}
          paintOrder="stroke"
          style={{ pointerEvents: "none" }}
        >
          {label}
        </text>
      )}
    </g>
  );
}
