#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

PORT="${CODE_PORT:-37631}"
HOST="${CODE_HOST:-0.0.0.0}"
CODEX_BIN="${CODEX_BIN:-$(command -v codex || true)}"

if ! command -v node >/dev/null 2>&1; then
  echo "error: Node.js is required" >&2
  exit 1
fi

if ! command -v corepack >/dev/null 2>&1; then
  echo "error: corepack is required" >&2
  exit 1
fi

if [[ -z "${CODEX_BIN}" ]]; then
  echo "error: codex was not found in PATH, set CODEX_BIN explicitly" >&2
  exit 1
fi

if [[ ! -x "${CODEX_BIN}" ]]; then
  echo "error: CODEX_BIN is not executable: ${CODEX_BIN}" >&2
  exit 1
fi

echo "==> repo: ${REPO_ROOT}"
echo "==> codex: ${CODEX_BIN}"
echo "==> listen: https://${HOST}:${PORT}"

cd "${REPO_ROOT}"

if [[ ! -d node_modules ]]; then
  echo "==> installing dependencies"
  corepack pnpm install --frozen-lockfile
fi

if [[ ! -f mac-service/dist/main.js ]]; then
  echo "==> building service"
  corepack pnpm --filter @code/protocol build
  corepack pnpm --filter @code/mac-service build
fi

export CODE_HOST="${HOST}"
export CODE_PORT="${PORT}"
export CODEX_BIN

echo "==> starting desktop service"
exec corepack pnpm --filter @code/mac-service start
