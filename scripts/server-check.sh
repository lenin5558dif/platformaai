#!/usr/bin/env bash
set -euo pipefail

bash ./scripts/server-lint.sh
bash ./scripts/server-test.sh
bash ./scripts/server-e2e.sh
