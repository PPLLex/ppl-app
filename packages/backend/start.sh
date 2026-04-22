#!/bin/sh
set -e

echo "=== PPL Backend Start ==="
echo "Node version: $(node --version)"
echo "Working directory: $(pwd)"
echo "PORT: ${PORT:-4000}"

echo "=== Running Prisma db push ==="
npx prisma db push --skip-generate --accept-data-loss
echo "=== Prisma done ==="

echo "=== Bootstrapping organizations ==="
# Idempotent — ensures the 4 core orgs (ppl, hpl, hpl-youth, renewed-performance)
# exist before any org-tagged data references them. See ARCHITECTURE.md.
npx tsx scripts/bootstrap-organizations.ts
echo "=== Org bootstrap done ==="

echo "=== Starting server ==="
exec node dist/server.js
