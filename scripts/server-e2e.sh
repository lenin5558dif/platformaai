#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${E2E_BASE_URL:-}" ]]; then
  if [[ -f .env ]]; then
    E2E_BASE_URL="$(grep -E '^NEXT_PUBLIC_APP_URL=' .env | tail -n 1 | cut -d= -f2-)"
  fi
fi

: "${E2E_BASE_URL:?Set E2E_BASE_URL before running server e2e checks}"

E2E_BASE_URL="$E2E_BASE_URL" npx playwright test
