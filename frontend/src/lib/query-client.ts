import { QueryCache, QueryClient } from "@tanstack/react-query";
import { useAuthStore } from "./auth/store";
import { isSessionError } from "./auth/session-errors";

function handleQueryError(error: unknown) {
  if (isSessionError(error)) {
    useAuthStore.getState().handleSessionExpired();
  }
}

/**
 * Single QueryClient for the whole app. Lives in its own module (rather than
 * main.tsx) so the auth-store watchers below — and their tests — can use it
 * without importing main.tsx, which mounts the app as a side effect.
 */
export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: handleQueryError }),
  defaultOptions: {
    queries: {
      // Monitoring data: fresh-ish, refetch on focus, no aggressive retries
      // (a slow history.get must never block the whole view — PLAN.md).
      staleTime: 15_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

/**
 * A silent Kerberos re-auth (store.handleSessionExpired) swaps the token
 * without unmounting anything, so the queries that failed on the dead session
 * have to be told to try again — otherwise the user stares at error states
 * until the next poll interval.
 */
function watchSilentReauth(client: QueryClient) {
  useAuthStore.subscribe((state, prev) => {
    if (prev.reauthenticating && !state.reauthenticating && state.token) {
      void client.refetchQueries({ type: "active" });
    }
  });
}

/**
 * Cached server data (hosts, problems, ...) must never leak from one signed-in
 * identity to the next: query keys carry no per-user identity, so whatever a
 * previous session fetched is still sitting in the cache — and would be
 * served straight to a different, possibly less-privileged, user without a
 * new request ever going out.
 *
 * We key the decision on `username` rather than `token`:
 *  - logout (username -> null) and the "session expired, fall back to the
 *    login form" path (username -> null) both change it -> clear.
 *  - login/loginWithSso as a genuinely different user changes it -> clear
 *    before the new user's screens can render with the old user's data.
 *  - a silent Kerberos renewal (handleSessionExpired -> attemptSso ->
 *    loginWithSso) mints a new token for the SAME username, so this does
 *    NOT fire -> no flash-to-empty during a transparent renewal.
 */
function watchIdentityChanges(client: QueryClient) {
  useAuthStore.subscribe((state, prev) => {
    if (state.username === prev.username) return;
    void client.cancelQueries();
    client.clear();
  });
}

watchSilentReauth(queryClient);
watchIdentityChanges(queryClient);
