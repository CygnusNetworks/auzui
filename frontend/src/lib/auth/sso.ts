/**
 * Kerberos/SPNEGO single-sign-on against the auzui-gateway.
 *
 * Contract (owned by the gateway, do not change here):
 *  - GET /api/auth/methods  -> { password: boolean, spnego: boolean }, no auth required.
 *  - GET /api/auth/spnego   -> browser handles the Negotiate handshake transparently
 *      (fetch with credentials: "include"); success: 200 { token, username };
 *      failure: 401 { detail: { sso_error } } or 404 if SPNEGO is disabled.
 */

const ATTEMPTED_KEY = "auzui-sso-attempted";
const SUPPRESSED_KEY = "auzui-sso-suppressed";

export interface SsoResult {
  token: string;
  username: string;
}

interface AuthMethodsResponse {
  password?: boolean;
  spnego?: boolean;
}

interface SpnegoResponse {
  token?: string;
  username?: string;
}

/** Whether an automatic SSO attempt has already happened in this tab session. */
export function isSsoAttempted(): boolean {
  return sessionStorage.getItem(ATTEMPTED_KEY) === "1";
}

/** Whether auto-SSO is suppressed (set by explicit logout) until the next hard reload. */
export function isSsoSuppressed(): boolean {
  return sessionStorage.getItem(SUPPRESSED_KEY) === "1";
}

/** Marks auto-SSO as suppressed; call this from the logout handler. */
export function markSsoSuppressed(): void {
  sessionStorage.setItem(SUPPRESSED_KEY, "1");
}

/**
 * Whether the gateway offers Kerberos/SPNEGO. Resolves to `false` (never
 * rejects) when the gateway is absent, unreachable, or SPNEGO is disabled, so
 * the login page only shows the Kerberos button when it can actually work.
 */
export async function fetchSpnegoEnabled(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/methods", { credentials: "include" });
    if (!res.ok) return false;
    const methods = (await res.json()) as AuthMethodsResponse;
    return methods.spnego === true;
  } catch {
    return false;
  }
}

/**
 * Attempts a transparent Kerberos/SPNEGO login via the gateway.
 *
 * Resolves to `null` (never rejects) whenever SSO isn't available or fails for
 * any reason: SPNEGO disabled, no Kerberos ticket, network error, malformed
 * response, already attempted this tab session, or suppressed after logout.
 * Callers should fall back to the password form in all of those cases.
 *
 * `force` (explicit user click on the Kerberos button) bypasses the
 * attempted/suppressed guards and re-arms auto-SSO for this tab session.
 */
export async function attemptSso(opts: { force?: boolean } = {}): Promise<SsoResult | null> {
  if (opts.force) {
    sessionStorage.removeItem(SUPPRESSED_KEY);
  } else if (isSsoAttempted() || isSsoSuppressed()) {
    return null;
  }
  sessionStorage.setItem(ATTEMPTED_KEY, "1");

  try {
    const methodsRes = await fetch("/api/auth/methods", { credentials: "include" });
    if (!methodsRes.ok) return null;
    const methods = (await methodsRes.json()) as AuthMethodsResponse;
    if (!methods.spnego) return null;

    const ssoRes = await fetch("/api/auth/spnego", { credentials: "include" });
    if (!ssoRes.ok) return null;
    const data = (await ssoRes.json()) as SpnegoResponse;
    if (!data.token || !data.username) return null;
    return { token: data.token, username: data.username };
  } catch {
    return null;
  }
}
