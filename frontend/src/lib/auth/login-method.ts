/**
 * Remembers how this browser last authenticated, so an expired session can
 * pick the right recovery path (tiqora's `lib/loginMethod.ts` pattern).
 *
 * The Zabbix session token itself carries no hint about its origin — a token
 * minted via `index_http.php` (Kerberos) looks exactly like one from
 * `user.login`. Only a remembered `spnego` login may be renewed silently via
 * the SPNEGO handshake; a password login must land on the normal form.
 *
 * Deliberately `localStorage`, not `sessionStorage`: the *token* is per-tab
 * (see docs/authentication.md), but "this machine uses Kerberos" is a
 * per-browser fact and is not a credential. An explicit logout clears it, so
 * the next person on a shared machine isn't silently re-authenticated.
 */
const KEY = "auzui-login-method";

export type LoginMethod = "password" | "spnego";

export function rememberLoginMethod(method: LoginMethod): void {
  try {
    localStorage.setItem(KEY, method);
  } catch {
    /* private mode / storage disabled — degrade to no silent re-auth */
  }
}

export function getLoginMethod(): LoginMethod | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "password" || value === "spnego" ? value : null;
  } catch {
    return null;
  }
}

export function clearLoginMethod(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
