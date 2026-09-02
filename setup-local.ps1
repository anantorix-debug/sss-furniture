# ============================================================================
# LOCAL DEVELOPMENT SETUP SCRIPT (Windows PowerShell)
# ============================================================================
# Run this script to set up the project for local development (no Docker)
# Usage: .\setup-local.ps1

param(
    [switch]$SkipDatabase = $false,
    [switch]$SkipDeps = $false
)

Write-Host "🚀 SSS Company - Local Development Setup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# Check Node.js
Write-Host "`n✓ Checking Node.js..." -ForegroundColor Green
$nodeVersion = node --version 2>$null
if ($null -eq $nodeVersion) {
    Write-Host "❌ Node.js not found. Please install Node.js 18+ from https://nodejs.org/" -ForegroundColor Red
    exit 1
}
Write-Host "  Found: $nodeVersion" -ForegroundColor Gray

# Check npm
Write-Host "✓ Checking npm..." -ForegroundColor Green
$npmVersion = npm --version 2>$null
Write-Host "  Found: npm $npmVersion" -ForegroundColor Gray

# Create .env.local if doesn't exist
Write-Host "`n✓ Setting up environment..." -ForegroundColor Green
if (-not (Test-Path ".\.env.local")) {
    if (Test-Path ".\.env.local.example") {
        Copy-Item ".\.env.local.example" ".\.env.local"
        Write-Host "  Created .env.local from template" -ForegroundColor Gray
        Write-Host "  ⚠️  Edit .env.local and update DATABASE_URL if needed" -ForegroundColor Yellow
    }
} else {
    Write-Host "  .env.local already exists" -ForegroundColor Gray
}

# Install dependencies
if (-not $SkipDeps) {
    Write-Host "`n✓ Installing dependencies..." -ForegroundColor Green
    Push-Location "apps/api"
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to install API dependencies" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Host "  API dependencies installed" -ForegroundColor Gray

    Push-Location "apps/web"
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "❌ Failed to install Web dependencies" -ForegroundColor Red
        Pop-Location
        exit 1
    }
    Pop-Location
    Write-Host "  Web dependencies installed" -ForegroundColor Gray
}

# Setup database
if (-not $SkipDatabase) {
    Write-Host "`n✓ Setting up database..." -ForegroundColor Green
    Write-Host "  Make sure MySQL is running locally (port 3306)" -ForegroundColor Yellow

    Push-Location "apps/api"
    Write-Host "  Running Prisma migrations..." -ForegroundColor Gray
    npx prisma migrate deploy 2>$null

    # Seed database
    Write-Host "  Seeding database..." -ForegroundColor Gray
    npx prisma db seed 2>$null

    Pop-Location
}

# Create directories
Write-Host "`n✓ Creating data directories..." -ForegroundColor Green
@(
    ".wwebjs_auth",
    "data/whatsapp-session",
    "apps/api/uploads"
) | ForEach-Object {
    if (-not (Test-Path $_)) {
        New-Item -ItemType Directory -Path $_ -Force | Out-Null
        Write-Host "  Created $_" -ForegroundColor Gray
    }
}

# Summary
Write-Host "`n✅ Setup Complete!" -ForegroundColor Green
Write-Host "`nNext steps:" -ForegroundColor Cyan
Write-Host "  1. Make sure MySQL is running locally (port 3306)" -ForegroundColor Gray
Write-Host "  2. Update .env.local with your database credentials if needed" -ForegroundColor Gray
Write-Host "  3. Start API:  cd apps/api && npm run start:dev" -ForegroundColor Gray
Write-Host "  4. Start Web:  cd apps/web && npm run dev" -ForegroundColor Gray
Write-Host "  5. Open browser at http://localhost:3000" -ForegroundColor Gray
Write-Host "`nOr use the npm scripts at root level:" -ForegroundColor Cyan
Write-Host "  npm run dev:all       # Start API + Web (requires 2 terminals)" -ForegroundColor Gray
Write-Host "  npm run db:setup      # Setup database from scratch" -ForegroundColor Gray
Write-Host "  npm run db:seed       # Seed sample data" -ForegroundColor Gray
