/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" enables the public demo build (mocked backend, auto-login) — see src/demo/. */
  readonly VITE_DEMO?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
