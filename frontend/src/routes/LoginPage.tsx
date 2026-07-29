import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuthStore } from "../lib/auth/store";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const login = useAuthStore((s) => s.login);
  const loggingIn = useAuthStore((s) => s.loggingIn);
  const loginError = useAuthStore((s) => s.loginError);
  const navigate = useNavigate();

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
    <div className="flex min-h-screen items-center justify-center bg-bg text-ink">
      <form
        onSubmit={onSubmit}
        className="w-[340px] rounded-xl border border-line bg-surface p-6 shadow-lg"
      >
        <div className="mb-6 text-center">
          <div className="font-mono text-2xl font-bold">
            au<span className="text-accent">z</span>ui
          </div>
          <div className="mt-1 text-xs text-ink-2">a usable zabbix ui</div>
        </div>

        <label className="mb-3 block text-xs text-ink-2">
          Benutzername
          <input
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus-visible:border-accent"
          />
        </label>
        <label className="mb-4 block text-xs text-ink-2">
          Passwort
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-md border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus-visible:border-accent"
          />
        </label>

        {loginError && <div className="mb-3 text-xs text-sev-high">{loginError}</div>}

        <button
          type="submit"
          disabled={loggingIn || username.length === 0 || password.length === 0}
          className="w-full rounded-md bg-accent px-3 py-2 text-sm font-semibold text-accent-ink disabled:opacity-50"
        >
          {loggingIn ? "Anmelden…" : "Anmelden"}
        </button>
      </form>
    </div>
  );
}
