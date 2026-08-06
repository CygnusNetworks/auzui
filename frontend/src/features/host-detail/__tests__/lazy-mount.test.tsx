import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LazyMount } from "../LazyMount";

/**
 * Minimal IntersectionObserver stub: records every instance so a test can
 * reach in and fire its callback manually, and tracks observe/unobserve/
 * disconnect calls so we can assert the gate cleans up after itself.
 */
class StubIntersectionObserver implements IntersectionObserver {
  static instances: StubIntersectionObserver[] = [];
  readonly root = null;
  readonly rootMargin = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  constructor(public callback: IntersectionObserverCallback) {
    StubIntersectionObserver.instances.push(this);
  }
  trigger(isIntersecting: boolean) {
    this.callback([{ isIntersecting } as IntersectionObserverEntry], this);
  }
}

afterEach(() => {
  StubIntersectionObserver.instances = [];
  // @ts-expect-error test-only cleanup of a test-only global
  delete globalThis.IntersectionObserver;
  vi.restoreAllMocks();
});

describe("LazyMount", () => {
  it("renders children immediately when IntersectionObserver doesn't exist (jsdom / old browsers)", () => {
    expect("IntersectionObserver" in globalThis).toBe(false);
    render(
      <LazyMount>
        <div>chart</div>
      </LazyMount>,
    );
    expect(screen.getByText("chart")).toBeInTheDocument();
  });

  it("mounts eager charts right away without ever creating an observer", () => {
    globalThis.IntersectionObserver = StubIntersectionObserver as unknown as typeof IntersectionObserver;
    render(
      <LazyMount eager>
        <div>chart</div>
      </LazyMount>,
    );
    expect(screen.getByText("chart")).toBeInTheDocument();
    expect(StubIntersectionObserver.instances).toHaveLength(0);
  });

  it("holds a placeholder until the observer reports intersection, then mounts the child and disconnects", () => {
    globalThis.IntersectionObserver = StubIntersectionObserver as unknown as typeof IntersectionObserver;
    render(
      <LazyMount>
        <div>chart</div>
      </LazyMount>,
    );

    expect(screen.queryByText("chart")).toBeNull();
    expect(StubIntersectionObserver.instances).toHaveLength(1);
    const observer = StubIntersectionObserver.instances[0]!;
    expect(observer.observe).toHaveBeenCalledTimes(1);

    act(() => {
      observer.trigger(true);
    });

    expect(screen.getByText("chart")).toBeInTheDocument();
    expect(observer.unobserve).toHaveBeenCalledTimes(1);
    // Called once explicitly on intersection, once more from the effect's
    // cleanup when `visible` flips and the effect re-runs — both are the
    // same idempotent observer, so just assert it did get disconnected.
    expect(observer.disconnect).toHaveBeenCalled();
  });

  it("ignores a non-intersecting callback and keeps the placeholder mounted", () => {
    globalThis.IntersectionObserver = StubIntersectionObserver as unknown as typeof IntersectionObserver;
    render(
      <LazyMount>
        <div>chart</div>
      </LazyMount>,
    );

    const observer = StubIntersectionObserver.instances[0]!;
    observer.trigger(false);

    expect(screen.queryByText("chart")).toBeNull();
    expect(observer.unobserve).not.toHaveBeenCalled();
  });
});
