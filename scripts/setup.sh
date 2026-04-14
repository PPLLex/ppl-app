#!/bin/bash
set -e

echo ""
echo "  ██████╗ ██████╗ ██╗"
echo "  ██╔══██╗██╔══██╗██║"
echo "  ██████╔╝██████╔╝██║"
echo "  ██╔═══╝ ██╔═══╝ ██║"
echo "  ██║     ██║     ███████╗"
echo "  ╚═╝     ╚═╝     ╚══════╝"
echo ""
echo "  Pitching Performance Lab — App Setup"
echo "  ======================================"
echo ""

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v docker &> /dev/null; then
  echo "❌ Docker is required. Install from https://docker.com"
  exit 1
fi
echo "  ✅ Docker"

if ! command -v node &> /dev/null; then
  echo "❌ Node.js is required. Install from https://nodejs.org"
  exit 1
fi
echo "  ✅ Node.js $(node --version)"

if ! command -v npm &> /dev/null; then
  echo "❌ npm is required."
  exit 1
fi
echo "  ✅ npm $(npm --version)"

# Start Docker services
echo ""
echo "Starting PostgreSQL and Redis..."
docker compose up -d
echo "  ✅ Database services running"

# Wait for PostgreSQL to be ready
echo ""
echo "Waiting for PostgreSQL..."
until docker exec ppl-postgres pg_isready -U ppl_user -d ppl_app > /dev/null 2>&1; do
  sleep 1
done
echo "  ✅ PostgreSQL ready"

# Install backend dependencies
echo ""
echo "Installing backend dependencies..."
cd packages/backend
npm install
echo "  ✅ Backend deps installed"

# Create .env if it doesn't exist
if [ ! -f .env ]; then
  cp .env.example .env
  echo "  ✅ Created .env from .env.example (edit with your Stripe/Twilio keys)"
else
  echo "  ✅ .env already exists"
fi

# Generate Prisma client and push schema
echo ""
echo "Setting up database..."
npx prisma generate
npx prisma db push
echo "  ✅ Database schema applied"

# Seed database
echo ""
echo "Seeding database..."
npx tsx prisma/seed.ts
echo "  ✅ Database seeded with locations, plans, and admin account"

# Install frontend dependencies
echo ""
echo "Installing frontend dependencies..."
cd ../frontend
npm install
echo "  ✅ Frontend deps installed"

echo ""
echo "======================================"
echo "  🎯 Setup complete!"
echo ""
echo "  To start the app:"
echo "    Terminal 1: cd packages/backend && npm run dev"
echo "    Terminal 2: cd packages/frontend && npm run dev"
echo ""
echo "  Backend:  http://localhost:4000"
echo "  Frontend: http://localhost:3000"
echo ""
echo "  Admin login:"
echo "    Email: cmart@pitchingperformancelab.com"
echo "    Password: (set during seed)"
echo ""
echo "  ⚠️  Don't forget to add your Stripe and Twilio"
echo "     keys to packages/backend/.env"
echo "======================================"
