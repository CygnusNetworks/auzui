# auzui common development targets
# Usage: just <recipe>

set dotenv-load := false

default:
    @just --list

# --- Install ---

# Install frontend workspace deps (pnpm monorepo)
install:
    pnpm install

# --- Quality (frontend + gateway) ---

# Lint everything (pnpm -r lint + ruff)
lint:
    pnpm -r lint
    uv run ruff check services/gateway/src services/gateway/tests
    uv run ruff format --check services/gateway

# Auto-fix lint issues
fmt:
    uv run ruff check --fix services/gateway/src services/gateway/tests
    uv run ruff format services/gateway

# Run all tests (frontend + gateway)
test:
    pnpm -r test
    uv run pytest services/gateway/tests

# Build all workspace packages + frontend
build:
    pnpm -r build

# --- Dev servers ---

# Frontend dev server
dev:
    pnpm --filter auzui-frontend dev

# Gateway dev server (uvicorn, reload)
gateway-dev:
    uv run --package auzui-gateway uvicorn auzui_gateway.main:app --reload --host 0.0.0.0 --port 8080
