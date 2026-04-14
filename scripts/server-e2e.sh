#!/usr/bin/env bash
set -euo pipefail

: "${E2E_BASE_URL:?Set E2E_BASE_URL before running server e2e checks}"

docker compose -f docker-compose.test.yml run --rm playwright
