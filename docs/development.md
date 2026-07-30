# Development

## Repository layout

auzui is a **pnpm workspace** (frontend + shared TS packages) plus a **uv
workspace** (the Python gateway), sharing one repo:

```
frontend/                 Vite + React 19 + TypeScript SPA (pnpm package "auzui-frontend")
packages/
  zabbix-client/           typed JSON-RPC client (generated TS types for used methods)
  timeseries/              TimeseriesSource abstraction (Zabbix + Influx) + LTTB point reduction
  logs/                    LogSource abstraction (Graylog), optional
services/
  gateway/                 auzui-gateway (FastAPI, Python, uv package "auzui-gateway")
docs/                      this documentation tree
site/                      static product page (GitHub Pages, deployed on release tags)
```

`pnpm-workspace.yaml` declares `frontend` and `packages/*` as workspace
members; the root `pyproject.toml` declares `services/gateway` as the sole
`uv` workspace member (`[tool.uv.workspace]`).

## Local setup

Prerequisites: Node ≥ 22, [pnpm](https://pnpm.io/) (version pinned via
`packageManager` in the root `package.json`), and
[uv](https://docs.astral.sh/uv/) for the gateway.

```bash
# Frontend + workspace TS packages
pnpm install

# Gateway (Python), with dev dependencies (pytest, ruff, respx)
uv sync --package auzui-gateway --extra dev
```

Or with [just](https://github.com/casey/just) (`justfile` at the repo root
wraps the same commands):

```bash
just install    # pnpm install
just dev        # frontend dev server (pnpm --filter auzui-frontend dev)
just gateway-dev  # uvicorn --reload for auzui-gateway
just lint       # pnpm -r lint  +  ruff check/format --check
just fmt        # ruff check --fix + ruff format (gateway only; frontend has no auto-fix recipe)
just test       # pnpm -r test  +  uv run pytest services/gateway/tests
just build      # pnpm -r build (workspace packages + frontend)
```

## Frontend commands

Run from `frontend/`, or via `pnpm --filter auzui-frontend <script>` /
`pnpm -r <script>` from the repo root (`frontend/package.json`):

| Script | Purpose |
|---|---|
| `pnpm dev` | Vite dev server |
| `pnpm lint` | `eslint src` |
| `pnpm build` | `tsc --noEmit && vite build` — type-checks before bundling |
| `pnpm test` | `vitest run` |
| `pnpm preview` | Preview a production build locally |

## Gateway commands

Run with `uv run --package auzui-gateway <cmd>` (or from inside
`services/gateway` with `uv run <cmd>`):

```bash
uv run ruff check services/gateway/src services/gateway/tests
uv run ruff format --check services/gateway   # or without --check to apply
uv run pytest services/gateway/tests
uv run uvicorn auzui_gateway.main:app --reload --host 0.0.0.0 --port 8080
```

Ruff config (`pyproject.toml`): target `py312`, line length 100, rule sets
`E, F, I, UP, B, SIM, ASYNC`. Pytest uses `asyncio_mode = "auto"`, test
discovery rooted at `services/gateway/tests`, `pythonpath` includes
`services/gateway/src` so tests import `auzui_gateway` without installing
the package.

## Demo mode

The public interactive demo
([cygnusnetworks.github.io/auzui/demo/](https://cygnusnetworks.github.io/auzui/demo/))
is the same SPA built against a mocked Zabbix API instead of a real backend,
so it can be served as static files with no gateway or Zabbix instance
behind it. Build/run it locally with the `VITE_DEMO` environment variable:

```bash
VITE_DEMO=1 pnpm dev          # dev server against mock data
pnpm build:demo               # static demo build (frontend/package.json)
```

Treat the demo build as read-only sample data, not a real deployment target
— it exists purely to let people click through the UI without standing up
Zabbix/InfluxDB/Graylog first. If `pnpm build:demo` is not yet present in
`frontend/package.json` in your checkout, the demo mode work described here
is still landing; fall back to the normal `pnpm dev`/`pnpm build`.

## Screenshot regeneration

The README and `docs/*.md` reference screenshots under `docs/images/` for a
fixed set of views — `problems`, `host-detail`, `latest-data`, `explorer`,
`topology`, `metrics`, `logs`, `command-palette` — each as both a light
(`<name>.png`) and dark (`<name>-dark.png`) variant. To regenerate:

1. Run the frontend (`pnpm dev`, or `VITE_DEMO=1 pnpm dev` against mock
   data so screenshots don't depend on a specific Zabbix instance's data).
2. For each view above, capture the browser viewport in both light and dark
   mode (toggle via the in-app theme switch), cropped to the main content
   area at a consistent window width (recommended: 1440px wide, no browser
   chrome).
3. Save as `docs/images/<name>.png` / `docs/images/<name>-dark.png`,
   overwriting the previous version — filenames are referenced by exact
   path from the README and doc pages, so do not rename them.

## Release checklist

Before opening a PR (also see the root [README's Contributing
section](../README.md#contributing)):

```bash
just lint
just test
just build
```

Keep documentation, user-facing strings, and code comments in English; do
not copy any Zabbix source into the tree (see the
[clean-room statement](../README.md#clean-room-statement)).
