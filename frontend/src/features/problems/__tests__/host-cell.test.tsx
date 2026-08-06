import { fireEvent, render as rtlRender, screen } from "@testing-library/react";
import type { MouseEvent, ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { HostCell } from "../LaneSection";
import { I18nProvider } from "../../../lib/i18n";

/**
 * HostCell links to the host deep-dive via TanStack Router's <Link>, which
 * needs a RouterProvider ancestor we don't want to stand up for a unit test.
 * Mocked here with a thin <a> stand-in that resolves `to`/`params` the same
 * way the real Link would (substituting `$hostId` etc.), so assertions on
 * the resulting href still exercise the real routing target.
 */
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    onClick,
    ...rest
  }: {
    to: string;
    params?: Record<string, string>;
    children?: ReactElement | string;
    onClick?: (e: MouseEvent) => void;
    [key: string]: unknown;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce((p, [k, v]) => p.replace(`$${k}`, v), to)}
      // jsdom would otherwise attempt a real (unsupported) navigation on click;
      // the real Link intercepts this via client-side routing.
      onClick={(e) => {
        e.preventDefault();
        onClick?.(e);
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

function render(ui: ReactElement) {
  return rtlRender(<I18nProvider initialLocale="de">{ui}</I18nProvider>);
}

describe("HostCell", () => {
  it("renders a link to the host deep-dive when hostId is set", () => {
    render(<HostCell hostName="core-sw01" hostId="10" />);
    expect(screen.getByText("core-sw01")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Host-Details für core-sw01 öffnen" });
    expect(link).toHaveAttribute("href", "/hosts/10");
  });

  it("renders no link when hostId is missing", () => {
    render(<HostCell hostName="core-sw01" />);
    expect(screen.getByText("core-sw01")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("shows a placeholder when hostName is missing", () => {
    render(<HostCell hostId="10" />);
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("stops the link click from propagating to a parent handler", () => {
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <HostCell hostName="core-sw01" hostId="10" />
      </div>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Host-Details für core-sw01 öffnen" }));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
