import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attemptSso, isSsoAttempted, isSsoSuppressed, markSsoSuppressed } from "../sso";

function jsonResponse(body: unknown, init: { status?: number } = {}) {
  return {
    ok: (init.status ?? 200) >= 200 && (init.status ?? 200) < 300,
    status: init.status ?? 200,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("attemptSso", () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null and makes no second request when SPNEGO is disabled", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ password: true, spnego: false }));

    const result = await attemptSso();

    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/auth/methods", { credentials: "include" });
  });

  it("returns token and username on success", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ password: true, spnego: true }))
      .mockResolvedValueOnce(jsonResponse({ token: "zbx-session-token", username: "jdoe" }));

    const result = await attemptSso();

    expect(result).toEqual({ token: "zbx-session-token", username: "jdoe" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/auth/spnego", { credentials: "include" });
  });

  it("returns null on a 401 SSO failure", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ password: true, spnego: true }))
      .mockResolvedValueOnce(
        jsonResponse({ detail: { sso_error: "no ticket" } }, { status: 401 }),
      );

    const result = await attemptSso();

    expect(result).toBeNull();
  });

  it("returns null on a 404 (SPNEGO route disabled)", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ password: true, spnego: true }))
      .mockResolvedValueOnce(jsonResponse({}, { status: 404 }));

    const result = await attemptSso();

    expect(result).toBeNull();
  });

  it("swallows network errors and returns null", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockRejectedValueOnce(new TypeError("network error"));

    const result = await attemptSso();

    expect(result).toBeNull();
  });

  it("marks the attempted flag and refuses a second auto-attempt in the same tab session", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse({ password: true, spnego: false }));

    expect(isSsoAttempted()).toBe(false);
    const first = await attemptSso();
    expect(first).toBeNull();
    expect(isSsoAttempted()).toBe(true);

    const second = await attemptSso();
    expect(second).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1); // no request on the second attempt
  });

  it("suppressed flag (set on logout) prevents an auto-attempt", async () => {
    const fetchMock = vi.mocked(fetch);
    expect(isSsoSuppressed()).toBe(false);

    markSsoSuppressed();
    expect(isSsoSuppressed()).toBe(true);

    const result = await attemptSso();

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
