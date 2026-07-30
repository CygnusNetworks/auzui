import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuthStore } from "../lib/auth/store";
import { attemptSso, isSsoAttempted, isSsoSuppressed } from "../lib/auth/sso";
import { Spinner } from "../components/Spinner";
import { useT } from "../lib/i18n";

export function LoginPage() {
  const t = useT();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useAuthStore((s) => s.login);
  const loginWithSso = useAuthStore((s) => s.loginWithSso);
  const loggingIn = useAuthStore((s) => s.loggingIn);
  const loginError = useAuthStore((s) => s.loginError);
  const navigate = useNavigate();

  const [checkingSso, setCheckingSso] = useState(() => !isSsoAttempted() && !isSsoSuppressed());
  const [ssoUnavailable, setSsoUnavailable] = useState(false);

  useEffect(() => {
    if (!checkingSso) return;
    let cancelled = false;
    void attemptSso().then((result) => {
      if (cancelled) return;
      if (result) {
        loginWithSso(result.token, result.username);
        void navigate({ to: "/" });
        return;
      }
      setSsoUnavailable(true);
      setCheckingSso(false);
    });
    return () => {
      cancelled = true;
    };
    // Runs once on mount only — attemptSso() guards against repeat attempts itself.
  }, []);

  function onKerberosClick() {
    setSsoUnavailable(false);
    setCheckingSso(true);
    void attemptSso({ force: true }).then((result) => {
      if (result) {
        loginWithSso(result.token, result.username);
        void navigate({ to: "/" });
        return;
      }
      setSsoUnavailable(true);
      setCheckingSso(false);
    });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await login(username, password);
      void navigate({ to: "/" });
    } catch {
      // loginError is already set in the store
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 text-ink">
      <div className="w-full max-w-[340px] min-h-[309px] rounded-xl border border-line bg-surface p-6 shadow-lg">
        <div className="mb-6 text-center">
          <img src={`${import.meta.env.BASE_URL}logo.svg`} alt="" className="mx-auto mb-3 h-10 w-10" />
          <div className="text-2xl font-extrabold tracking-tight">
            au<span className="text-accent">z</span>ui
          </div>
          <div className="mt-1 text-xs text-ink-2">{t("login.tagline")}</div>
        </div>

        {checkingSso ? (
          <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
            <Spinner className="h-5 w-5" />
            <span className="text-xs text-ink-2">{t("login.checkingSso")}</span>
          </div>
        ) : (
          <form onSubmit={onSubmit}>
            <label className="mb-3 block text-xs text-ink-2">
              {t("login.username")}
              <input
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus-visible:border-accent"
              />
            </label>
            <label className="mb-4 block text-xs text-ink-2">
              {t("login.password")}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus-visible:border-accent"
              />
            </label>

            {ssoUnavailable && !loginError && (
              <div className="mb-3 text-xs text-ink-muted">{t("login.ssoUnavailable")}</div>
            )}
            {loginError && <div className="mb-3 text-xs text-sev-high">{loginError}</div>}

            <button
              type="submit"
              disabled={loggingIn || username.length === 0 || password.length === 0}
              className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
            >
              {loggingIn ? t("login.signingIn") : t("login.signIn")}
            </button>
            <button
              type="button"
              onClick={onKerberosClick}
              className="mt-2 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2"
            >
              {t("login.signInWithKerberos")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
