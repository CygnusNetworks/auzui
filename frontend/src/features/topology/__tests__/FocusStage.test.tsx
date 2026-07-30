import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { I18nProvider } from "../../../lib/i18n";
import { FocusStage } from "../FocusStage";
import type { ClusterHostRef, ClusterSummary } from "../../../lib/topology";
import type { Severity } from "../../../lib/severity";

// FocusStage navigates on host click; the layout/collapse logic under test does
// not need a real router.
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {} }));

function mkHost(hostid: string, label: string, severity: Severity | undefined): ClusterHostRef {
  return { hostid, label, severity, problemCount: severity === undefined ? 0 : 1, ip: undefined };
}

/** Small mostly-OK cluster (a few Info problems + OK hosts), no name families. */
function makeFlatCluster(id: string, okCount: number, problemCount: number): ClusterSummary {
  const hosts: ClusterHostRef[] = [];
  for (let i = 0; i < problemCount; i++) hosts.push(mkHost(`${id}-p${i}`, `problem-${i}`, 1 as Severity));
  for (let i = 0; i < okCount; i++) hosts.push(mkHost(`${id}-o${i}`, `okhost-${i}`, undefined));
  return { id, kind: "proxy", name: "Direkt überwacht (ohne Proxy)", hosts, severity: 1 as Severity };
}

function makeCluster(id: string, hosts: ClusterHostRef[]): ClusterSummary {
  return { id, kind: "proxy", name: "Direkt überwacht (ohne Proxy)", hosts, severity: 1 as Severity };
}

function range(prefix: string, n: number, sev: Severity | undefined = undefined): ClusterHostRef[] {
  return Array.from({ length: n }, (_, i) => {
    const name = `${prefix}${String(i + 1).padStart(2, "0")}`;
    return mkHost(name, name, sev);
  });
}

function renderStage(cluster: ClusterSummary) {
  return render(
    <I18nProvider initialLocale="en">
      <FocusStage cluster={cluster} />
    </I18nProvider>,
  );
}

describe("FocusStage — flat layout (small clusters)", () => {
  it("keeps all labels for a small cluster (at/below the density threshold)", () => {
    const { getByText } = renderStage(makeFlatCluster("C", 10, 3));
    expect(getByText("okhost-0")).toBeTruthy();
    expect(getByText("problem-0")).toBeTruthy();
  });

  it("still OK-collapses a large but unfamiliable cluster (all-unique names → 1 family → flat path)", () => {
    // 30 OK hosts with wholly unrelated single-token names → one "Sonstige"
    // family → semantic disabled → flat layout → OK-collapse fires (> 24 OK).
    const names = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel", "india", "juliet",
      "kilo", "lima", "mike", "november", "oscar", "papa", "quebec", "romeo", "sierra", "tango",
      "uniform", "victor", "whiskey", "xray", "yankee", "zulu", "nadir", "zenith", "apex", "crux"];
    const hosts = names.map((n) => mkHost(n, n, undefined));
    const { getByText } = renderStage(makeCluster("F", hosts));
    expect(getByText("+30 OK hosts")).toBeTruthy();
  });
});

describe("FocusStage — semantic zoom (large clusters)", () => {
  it("bundles a big problem-dominated cluster into name-family meta-nodes (not ~200 dots)", () => {
    // 195 okhost-* + 5 problem-* (all Info, ≤ Warning) → two families, both fold
    // into meta-nodes; no individual host dots at detail-level 1.
    const cluster = makeCluster("A", [...range("problem-", 5, 1 as Severity), ...range("okhost-", 195)]);
    const { getByText, queryByText } = renderStage(cluster);
    expect(getByText(/okhost-…\s*\(195\)/)).toBeTruthy();
    expect(getByText(/problem-…\s*\(5\)/)).toBeTruthy();
    // Individual members are folded away at level 1.
    expect(queryByText("okhost-01")).toBeNull();
    expect(queryByText("problem-01")).toBeNull();
  });

  it("keeps an Average+ host as an individual labelled dot on level 1, folding the rest", () => {
    // Family "srv-": srv-crit is Average (≥ 3) → always standalone; the 30 OK
    // srv-* fold into a meta-node. A second family "gw-" makes semantic engage.
    const cluster = makeCluster("B", [
      mkHost("srv-crit", "srv-crit", 3 as Severity),
      ...range("srv-", 30),
      ...range("gw-", 5),
    ]);
    const { getByText, queryByText } = renderStage(cluster);
    expect(getByText("srv-crit")).toBeTruthy(); // standalone Average+ host, labelled
    expect(getByText(/srv-…\s*\(31\)/)).toBeTruthy(); // meta-node for the folded OK hosts (incl. srv-crit in the count)
    expect(queryByText("srv-01")).toBeNull(); // a folded OK member is not an individual dot
  });

  it("expands a family into individual dots on click", () => {
    // Two families so semantic engages; click the srv-* meta-node to expand it.
    const cluster = makeCluster("E", [...range("srv-", 40), ...range("gw-", 5)]);
    const { getByText, queryByText } = renderStage(cluster);
    // Level 1: folded meta-node, no individual members.
    expect(queryByText("srv-02")).toBeNull();
    const meta = getByText(/srv-…\s*\(40\)/);
    fireEvent.click(meta);
    // After the click the family is focused → its members render individually.
    expect(getByText("srv-02")).toBeTruthy();
    expect(getByText("srv-40")).toBeTruthy();
  });
});
