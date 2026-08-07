import type { ReactNode } from "react";
import type { DockerResourceRow } from "@auzui/docker";
import {
  formatBytes,
  imageDigest,
  imageReclaimable,
  networkFlags,
  networkGateways,
  networkSubnets,
  resourceAge,
  resourceComposeProject,
  resourceCreatedAt,
  resourceLabels,
  shortDockerId,
  type DockerResourceType,
} from "../../lib/docker";
import { useT } from "../../lib/i18n";
import { UnusedBadge } from "./UnusedBadge";

/**
 * The right-hand panel for a selected image/volume/network. The lane rows
 * stay deliberately lean, so everything else Docker reports about a resource
 * lands here: the long tail (labels, digests, options) is the reason this
 * view is worth a panel rather than more columns.
 */
export function ResourceDetailPanel({
  type,
  display,
  hostLabel,
}: {
  type: DockerResourceType;
  /** The selected row, or undefined when nothing is selected. */
  display: { name: string; row: DockerResourceRow; usedBy: string[] } | undefined;
  hostLabel: string;
}) {
  const t = useT();

  if (!display) {
    return <div className="p-3.5 text-sm text-ink-2">{t("docker.resourceDetail.noneSelected")}</div>;
  }

  const { row, usedBy } = display;
  const labels = resourceLabels(row);
  const project = resourceComposeProject(row);
  const created = resourceCreatedAt(row);

  return (
    <div>
      <div className="border-b border-line-soft p-3.5">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
          {t(`docker.searchTypeSingular.${type}`)} · {hostLabel}
        </div>
        <div className="break-all font-mono text-[12.5px] font-semibold text-ink">{display.name}</div>
        {project && <div className="mt-1 font-mono text-[10.5px] text-accent">{project}</div>}
      </div>

      <Section title={t("docker.resourceDetail.properties")}>
        {created !== undefined && <Fact label={t("docker.resourceDetail.created")} value={formatCreated(created, t)} />}
        {type === "images" && <ImageFacts row={row} />}
        {type === "volumes" && <VolumeFacts row={row} />}
        {type === "networks" && <NetworkFacts row={row} />}
      </Section>

      <Section title={t("docker.resourceDetail.usedBy")}>
        {usedBy.length === 0 ? (
          <div className="col-span-2 flex flex-col gap-1.5">
            <UnusedBadge className="self-start" />
            <p className="font-sans text-[11.5px] leading-snug text-ink-2">
              {type === "images"
                ? t("docker.resourceDetail.unusedImageHint", formatBytes(imageReclaimable(row) ?? 0))
                : t(`docker.resourceDetail.unusedHint.${type}`)}
            </p>
          </div>
        ) : (
          <div className="col-span-2 flex flex-wrap gap-1">
            {usedBy.map((name) => (
              <span
                key={name}
                className="rounded border border-line bg-surface-2 px-1.5 font-mono text-[10.5px] leading-[17px] text-ink-2"
              >
                {name}
              </span>
            ))}
          </div>
        )}
      </Section>

      {labels.length > 0 && (
        <Section title={t("docker.resourceDetail.labels")}>
          {labels.map((label) => (
            <Fact key={label.key} label={label.key} value={label.value} />
          ))}
        </Section>
      )}
    </div>
  );
}

/** Panel section: an uppercase eyebrow above a two-column fact grid — the same
 * structure ContainerDetailPanel's Info tab uses, so both panels read alike. */
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="border-b border-line-soft p-3.5 last:border-b-0">
      <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-muted">{title}</div>
      <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-[11.5px] text-ink-2">{children}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="whitespace-nowrap">{label}</span>
      <span className="break-all text-ink">{value}</span>
    </>
  );
}

function ImageFacts({ row }: { row: DockerResourceRow }) {
  const t = useT();
  const tags = (Array.isArray(row.RepoTags) ? row.RepoTags : []).filter(
    (tag): tag is string => typeof tag === "string" && tag !== "<none>:<none>",
  );
  const digest = imageDigest(row);
  // SharedSize is -1 unless the caller asked Docker to compute it, which
  // docker-py's images.list() does not — so it is shown only when real.
  const shared = typeof row.SharedSize === "number" && row.SharedSize >= 0 ? row.SharedSize : undefined;
  return (
    <>
      {typeof row.Size === "number" && <Fact label={t("docker.resourceDetail.size")} value={formatBytes(row.Size)} />}
      {shared !== undefined && <Fact label={t("docker.resourceDetail.shared")} value={formatBytes(shared)} />}
      <Fact
        label={t("docker.resourceDetail.tags")}
        value={tags.length > 0 ? tags.join(", ") : t("docker.resourceDetail.untagged")}
      />
      <Fact label={t("docker.resourceDetail.id")} value={shortDockerId(String(row.Id ?? ""))} />
      {digest && <Fact label={t("docker.resourceDetail.digest")} value={digest} />}
    </>
  );
}

function VolumeFacts({ row }: { row: DockerResourceRow }) {
  const t = useT();
  const options = row.Options && typeof row.Options === "object" ? Object.entries(row.Options) : [];
  return (
    <>
      {typeof row.Driver === "string" && <Fact label={t("docker.resourceDetail.driver")} value={row.Driver} />}
      {typeof row.Scope === "string" && <Fact label={t("docker.resourceDetail.scope")} value={row.Scope} />}
      {typeof row.Mountpoint === "string" && (
        <Fact label={t("docker.resourceDetail.mountpoint")} value={row.Mountpoint} />
      )}
      {options.map(([key, value]) => (
        <Fact key={key} label={key} value={String(value)} />
      ))}
    </>
  );
}

function NetworkFacts({ row }: { row: DockerResourceRow }) {
  const t = useT();
  const subnets = networkSubnets(row);
  const gateways = networkGateways(row);
  const flags = networkFlags(row);
  return (
    <>
      {typeof row.Driver === "string" && <Fact label={t("docker.resourceDetail.driver")} value={row.Driver} />}
      {typeof row.Scope === "string" && <Fact label={t("docker.resourceDetail.scope")} value={row.Scope} />}
      {/* `host` and `none` have no IPAM config at all — saying so beats an
          empty row that reads as a missing value. */}
      <Fact
        label={t("docker.resourceDetail.subnet")}
        value={subnets.length > 0 ? subnets.join(", ") : t("docker.resourceDetail.noSubnet")}
      />
      {gateways.length > 0 && <Fact label={t("docker.resourceDetail.gateway")} value={gateways.join(", ")} />}
      <Fact
        label={t("docker.resourceDetail.flags")}
        value={flags.length > 0 ? flags.join(", ") : t("docker.resourceDetail.noFlags")}
      />
      {typeof row.Id === "string" && <Fact label={t("docker.resourceDetail.id")} value={shortDockerId(row.Id)} />}
    </>
  );
}

/** Absolute date plus the coarse age the lane row shows, so the panel answers
 * both "when exactly" and "how long has this been lying around". */
function formatCreated(createdSeconds: number, t: ReturnType<typeof useT>): string {
  const age = resourceAge(createdSeconds);
  const absolute = new Date(createdSeconds * 1000).toLocaleDateString();
  return `${absolute} · ${t(`docker.age.${age.unit}`, age.value)}`;
}
