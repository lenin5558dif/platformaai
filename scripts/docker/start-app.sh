#!/bin/sh
set -eu

echo "Applying Prisma migrations..."
i=0
while true; do
  output_file="$(mktemp)"
  if npx prisma migrate deploy >"$output_file" 2>&1; then
    cat "$output_file"
    rm -f "$output_file"
    break
  fi

  cat "$output_file"

  if grep -q "Error: P3009" "$output_file"; then
    echo "Found an existing failed Prisma migration in the target database. Skipping migrate deploy and starting the app."
    rm -f "$output_file"
    break
  fi

  rm -f "$output_file"
  i=$((i + 1))
  if [ "$i" -ge 30 ]; then
    echo "Prisma migrations failed after 30 attempts"
    exit 1
  fi
  echo "Database is not ready yet, retrying in 2s..."
  sleep 2
done

echo "Starting Next.js..."
exec node /app/server.js
