#!/bin/bash
# ============================================================================
# LOCAL DEVELOPMENT SETUP SCRIPT (macOS/Linux)
# ============================================================================
# Run this script to set up the project for local development (no Docker)
# Usage: chmod +x setup-local.sh && ./setup-local.sh

set -e

echo "🚀 SSS Company - Local Development Setup"
echo "============================================"

# Check Node.js
echo ""
echo "✓ Checking Node.js..."
if ! command -v node &> /dev/null; then
    echo "❌ Node.js not found. Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi
NODE_VERSION=$(node --version)
echo "  Found: $NODE_VERSION"

# Check npm
echo "✓ Checking npm..."
NPM_VERSION=$(npm --version)
echo "  Found: npm $NPM_VERSION"

# Create .env.local if doesn't exist
echo ""
echo "✓ Setting up environment..."
if [ ! -f .env.local ]; then
    if [ -f .env.local.example ]; then
        cp .env.local.example .env.local
        echo "  Created .env.local from template"
        echo "  ⚠️  Edit .env.local and update DATABASE_URL if needed"
    fi
else
    echo "  .env.local already exists"
fi

# Install dependencies
echo ""
echo "✓ Installing dependencies..."
cd apps/api
npm install
echo "  API dependencies installed"
cd ../../

cd apps/web
npm install
echo "  Web dependencies installed"
cd ../../

# Setup database
echo ""
echo "✓ Setting up database..."
echo "  Make sure MySQL is running locally (port 3306)"

cd apps/api
echo "  Running Prisma migrations..."
npx prisma migrate deploy || true

echo "  Seeding database..."
npx prisma db seed || true

cd ../../

# Create directories
echo ""
echo "✓ Creating data directories..."
mkdir -p .wwebjs_auth
mkdir -p data/whatsapp-session
mkdir -p apps/api/uploads
echo "  Directories created"

# Summary
echo ""
echo "✅ Setup Complete!"
echo ""
echo "Next steps:"
echo "  1. Make sure MySQL is running locally (port 3306)"
echo "  2. Update .env.local with your database credentials if needed"
echo "  3. Start API:  cd apps/api && npm run start:dev"
echo "  4. Start Web:  cd apps/web && npm run dev"
echo "  5. Open browser at http://localhost:3000"
echo ""
echo "Or use the npm scripts at root level:"
echo "  npm run dev:all       # Start API + Web (requires 2 terminals)"
echo "  npm run db:setup      # Setup database from scratch"
echo "  npm run db:seed       # Seed sample data"
