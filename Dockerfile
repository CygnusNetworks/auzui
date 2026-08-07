# Multi-stage build: one image = auzui-gateway (FastAPI) + auzui SPA (static).
# The gateway serves the built frontend directly (SETTINGS.serve_frontend).

ARG PYTHON_VERSION=3.12
ARG NODE_VERSION=22
ARG PNPM_VERSION=11.20.0

# ---------- Frontend build ----------
# frontend/ is part of a pnpm workspace together with packages/* (workspace:*
# deps consumed as TS source, no separate package build step needed), so the
# whole workspace context is required for a correct `pnpm install`.
FROM node:${NODE_VERSION}-alpine AS frontend-build
ARG PNPM_VERSION
WORKDIR /workspace

RUN corepack enable \
    && corepack prepare pnpm@${PNPM_VERSION} --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/ ./packages/
COPY frontend/package.json ./frontend/
RUN pnpm install --frozen-lockfile

COPY frontend/ ./frontend/

# Build provenance surfaced in the SPA (falls back to build metadata when empty).
ARG VITE_APP_VERSION=""
ENV VITE_APP_VERSION=$VITE_APP_VERSION

RUN pnpm --filter auzui-frontend build

# ---------- Python deps ----------
# uv workspace: root pyproject.toml (package = false) + services/gateway member.
FROM python:${PYTHON_VERSION}-slim AS python-deps
ARG TARGETARCH
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc libkrb5-dev \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

COPY pyproject.toml uv.lock ./
COPY services/gateway/pyproject.toml services/gateway/README.md services/gateway/
COPY services/gateway/src services/gateway/src

# Internal-only escape hatch: python-gssapi has no upstream Linux wheel and
# compiles its C extension from source. Under QEMU-emulated arm64 (our
# internal Jenkins build, see Jenkinsfile) this reproducibly crashes gcc's
# cc1 with SIGSEGV after ~35min. GSSAPI_ARM64_WHEEL_URL, when set, points at
# a wheel built natively on real arm64 hardware and hosted on our internal
# pypi.cygnusnet.de, sidestepping the compile entirely. Left empty (the
# default, and what GitHub Actions always uses), this is a no-op and `uv
# sync` behaves exactly as before.
ARG GSSAPI_ARM64_WHEEL_URL=""
RUN if [ -n "$GSSAPI_ARM64_WHEEL_URL" ] && [ "$TARGETARCH" = "arm64" ]; then \
        locked_version=$(grep -A1 '^name = "gssapi"' uv.lock | grep '^version' | sed -E 's/version = "(.*)"/\1/'); \
        wheel_version=$(echo "$GSSAPI_ARM64_WHEEL_URL" | sed -E 's#.*/gssapi-([0-9.]+)-.*#\1#'); \
        if [ "$locked_version" != "$wheel_version" ]; then \
            echo "ERROR: GSSAPI_ARM64_WHEEL_URL points at gssapi $wheel_version but uv.lock pins $locked_version -- rebuild the wheel on access1.cygnusnet.de (see Jenkinsfile) and update GSSAPI_ARM64_WHEEL_URL there" >&2; \
            exit 1; \
        fi; \
        uv sync --package auzui-gateway --no-dev --frozen --extra kerberos --extra docker --extra yaml --no-install-package gssapi \
        && uv pip install "$GSSAPI_ARM64_WHEEL_URL"; \
    else \
        uv sync --package auzui-gateway --no-dev --frozen --extra kerberos --extra docker --extra yaml; \
    fi

# ---------- Runtime ----------
FROM python:${PYTHON_VERSION}-slim AS runtime
WORKDIR /app

RUN useradd --create-home --uid 1000 auzui \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libgssapi-krb5-2 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=python-deps /app/.venv /app/.venv
COPY services/gateway/src /app/src
COPY --from=frontend-build /workspace/frontend/dist /app/static

# Build provenance (see services/gateway/src/auzui_gateway/__init__.py for the
# package-metadata fallback used when these are empty, e.g. plain local builds).
ARG AUZUI_VERSION=""
ARG AUZUI_GIT_SHA=""
ARG AUZUI_BUILD_TIME=""

# NOTE: pydantic-settings Settings in config.py has no env_prefix, so field
# names map 1:1 to upper-cased env vars (serve_frontend -> SERVE_FRONTEND,
# frontend_dir -> FRONTEND_DIR) — no AUZUI_ prefix here.
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONPATH="/app/src" \
    PYTHONUNBUFFERED=1 \
    SERVE_FRONTEND=1 \
    FRONTEND_DIR=/app/static \
    AUZUI_VERSION=$AUZUI_VERSION \
    AUZUI_GIT_SHA=$AUZUI_GIT_SHA \
    AUZUI_BUILD_TIME=$AUZUI_BUILD_TIME

LABEL org.opencontainers.image.title="auzui" \
      org.opencontainers.image.description="A Usable Zabbix UI — gateway + SPA" \
      org.opencontainers.image.source="https://github.com/cygnusnetworks/auzui" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version=$AUZUI_VERSION \
      org.opencontainers.image.revision=$AUZUI_GIT_SHA \
      org.opencontainers.image.created=$AUZUI_BUILD_TIME

RUN chown -R auzui:auzui /app/static

USER auzui
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -fs http://localhost:8000/health || exit 1

CMD ["uvicorn", "auzui_gateway.main:app", "--host", "0.0.0.0", "--port", "8000"]
