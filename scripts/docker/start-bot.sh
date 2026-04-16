#!/bin/sh
set -eu

echo "Starting Telegram bot..."
exec npx tsx src/bot/index.ts
