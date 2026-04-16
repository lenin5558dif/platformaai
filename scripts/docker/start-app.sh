#!/bin/sh
set -eu

echo "Applying Prisma migrations..."
i=0
until npx prisma migrate deploy; do
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
