#!/bin/sh
set -e

echo "=== PPL Backend Start ==="
echo "Node version: $(node --version)"
echo "Working directory: $(pwd)"
echo "PORT: ${PORT:-4000}"

echo "=== Running Prisma db push ==="
npx prisma db push --skip-generate --accept-data-loss
echo "=== Prisma done ==="

# Organization bootstrapping is now inside the compiled server (see
# src/bootstrapOrgs.ts, called from server.ts's start() before app.listen).
# That makes it part of the normal Node runtime — no tsx, no scripts/ folder
# copied into the Docker image, no loose .ts files that could vanish.

echo "=== Starting server ==="
exec node dist/server.js
