import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DockerSource } from "@auzui/docker";
import { ActionButtons } from "../ActionButtons";
import { I18nProvider } from "../../../lib/i18n";

/**
 * ActionButtons needs a react-query client (its action mutation) and an
 * I18nProvider; the locale is pinned to "de" because these assertions read
 * the German labels.
 */
function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(
    <QueryClientProvider client={client}>
      <I18nProvider initialLocale="de">{ui}</I18nProvider>
    </QueryClientProvider>,
  );
}

const source = { enabled: true, action: vi.fn() } as unknown as DockerSource;

function buttons() {
  return screen.getAllByRole("button");
}

describe("ActionButtons: the two halves of the action gate", () => {
  it("renders nothing at all without the global permission", () => {
    const { container } = render(
      <ActionButtons source={source} hostId="prod-a" cid="c1" state="running" canAct={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers enabled actions on a writable host", () => {
    render(<ActionButtons source={source} hostId="prod-a" cid="c1" state="running" canAct />);
    expect(buttons()).toHaveLength(3);
    for (const button of buttons()) expect(button).toBeEnabled();
  });

  // The readonly host is the case the UI used to get wrong: the gateway
  // rejects the action with 403, so the buttons must not invite the click.
  it("keeps the actions visible but disabled on a readonly host", () => {
    render(
      <ActionButtons
        source={source}
        hostId="prod-a"
        cid="c1"
        state="running"
        canAct
        disabledReason="Host ist schreibgeschützt"
      />,
    );
    expect(buttons()).toHaveLength(3);
    for (const button of buttons()) expect(button).toBeDisabled();
    expect(screen.getByTitle("Host ist schreibgeschützt")).toBeInTheDocument();
  });

  it("shows start instead of stop for a container that is not running", () => {
    render(<ActionButtons source={source} hostId="prod-a" cid="c1" state="exited" canAct />);
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).toBeNull();
  });
});
