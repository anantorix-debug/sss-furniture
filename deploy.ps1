# ============================================================================
# DEPLOYMENT SCRIPT (Windows PowerShell)
# ============================================================================
# Supports multiple deployment scenarios:
# - Local development setup
# - Docker full stack
# - Docker WhatsApp-only
# - Production VPS
#
# Usage:
#   .\deploy.ps1 -mode local
#   .\deploy.ps1 -mode docker
#   .\deploy.ps1 -mode docker-whatsapp
#   .\deploy.ps1 -mode prod -host user@vps.example.com

param(
    [ValidateSet('local', 'docker', 'docker-whatsapp', 'prod')]
    [string]$mode = 'local',

    [string]$host = $null,
    [switch]$rebuild = $false,
    [switch]$skipDb = $false,
    [switch]$help = $false
)

$ErrorActionPreference = "Stop"

# Helper functions
function Write-Header {
    param([string]$text)
    Write-Host ""
    Write-Host "═════════════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host $text -ForegroundColor Cyan
    Write-Host "═════════════════════════════════════════════════════════" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$text)
    Write-Host "✅ $text" -ForegroundColor Green
}

function Write-Error-Custom {
    param([string]$text)
    Write-Host "❌ $text" -ForegroundColor Red
}

function Write-Info {
    param([string]$text)
    Write-Host "ℹ️  $text" -ForegroundColor Yellow
}

# Show help
if ($help) {
    Write-Host @"
SSS Company - Deployment Script

USAGE:
  .\deploy.ps1 -mode <mode> [options]

MODES:
  local               Local development (no Docker)
  docker              Full stack Docker (API + DB + Web)
  docker-whatsapp     WhatsApp-only Docker (API local + DB local)
  prod                Production VPS deployment

OPTIONS:
  -rebuild            Rebuild Docker images
  -skipDb             Skip database setup
  -host user@vps      VPS SSH connection string (for prod mode)
  -help               Show this help message

EXAMPLES:
  # Local development
  .\deploy.ps1 -mode local

  # Docker full stack with rebuild
  .\deploy.ps1 -mode docker -rebuild

  # WhatsApp-only Docker
  .\deploy.ps1 -mode docker-whatsapp

  # Production deployment
  .\deploy.ps1 -mode prod -host deploy@sss-vps.example.com
"@
    exit 0
}

Write-Header "SSS Company - Deployment Script"
Write-Host "Mode: $mode"
Write-Host "Rebuild: $rebuild"
Write-Host "Skip DB: $skipDb"

# ============================================================================
# LOCAL MODE
# ============================================================================
if ($mode -eq 'local') {
    Write-Header "LOCAL DEVELOPMENT SETUP"

    # Check prerequisites
    Write-Info "Checking prerequisites..."

    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Error-Custom "Node.js not found. Install from https://nodejs.org/"
        exit 1
    }
    Write-Success "Node.js found: $(node --version)"

    if (-not (Get-Command mysql -ErrorAction SilentlyContinue)) {
        Write-Info "MySQL not found in PATH, but may still be running"
        Write-Info "Ensure MySQL is running on localhost:3306"
    }

    # Setup environment
    Write-Info "Setting up environment..."
    if (-not (Test-Path ".env.local")) {
        Copy-Item ".env.local.example" ".env.local"
        Write-Success "Created .env.local"
        Write-Info "⚠️  Edit .env.local with your database credentials"
    } else {
        Write-Success ".env.local already exists"
    }

    # Install dependencies
    Write-Info "Installing dependencies..."
    Push-Location "apps/api"
    npm install
    Pop-Location
    Write-Success "API dependencies installed"

    Push-Location "apps/web"
    npm install
    Pop-Location
    Write-Success "Web dependencies installed"

    # Setup database
    if (-not $skipDb) {
        Write-Info "Setting up database..."
        Push-Location "apps/api"
        npx prisma migrate deploy 2>$null
        Write-Success "Database migrated"
        Pop-Location
    }

    # Create directories
    @(".wwebjs_auth", "data/whatsapp-session", "apps/api/uploads") | ForEach-Object {
        if (-not (Test-Path $_)) {
            New-Item -ItemType Directory -Path $_ -Force | Out-Null
        }
    }

    Write-Header "✅ LOCAL SETUP COMPLETE"
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Start API:  cd apps/api && npm run start:dev" -ForegroundColor Gray
    Write-Host "  2. Start Web:  cd apps/web && npm run dev" -ForegroundColor Gray
    Write-Host "  3. Open:       http://localhost:3000" -ForegroundColor Gray
}

# ============================================================================
# DOCKER MODE
# ============================================================================
elseif ($mode -eq 'docker') {
    Write-Header "DOCKER FULL STACK DEPLOYMENT"

    # Check Docker
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Error-Custom "Docker not found. Install from https://www.docker.com/"
        exit 1
    }
    Write-Success "Docker found: $(docker --version)"

    # Build
    if ($rebuild) {
        Write-Info "Building Docker images..."
        docker-compose build --no-cache
        Write-Success "Images built"
    }

    # Start
    Write-Info "Starting containers..."
    docker-compose up -d
    Write-Success "Containers started"

    # Wait for health
    Write-Info "Waiting for services to be ready..."
    Start-Sleep -Seconds 10

    $maxAttempts = 30
    $attempt = 0
    while ($attempt -lt $maxAttempts) {
        $apiReady = docker-compose exec -T api node -e "require('http').get('http://localhost:4000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Success "API is ready"
            break
        }
        $attempt++
        Write-Info "Waiting for API... ($attempt/$maxAttempts)"
        Start-Sleep -Seconds 2
    }

    Write-Header "✅ DOCKER DEPLOYMENT COMPLETE"
    Write-Host ""
    Write-Host "Services running:" -ForegroundColor Cyan
    Write-Host "  Web:    http://localhost:3001" -ForegroundColor Gray
    Write-Host "  API:    http://localhost:4000/api" -ForegroundColor Gray
    Write-Host "  Docs:   http://localhost:4000/api/docs" -ForegroundColor Gray
    Write-Host ""
    Write-Host "Useful commands:" -ForegroundColor Cyan
    Write-Host "  docker-compose logs -f         # View all logs" -ForegroundColor Gray
    Write-Host "  docker-compose logs -f api     # View API logs" -ForegroundColor Gray
    Write-Host "  docker-compose down            # Stop all containers" -ForegroundColor Gray
}

# ============================================================================
# DOCKER WHATSAPP MODE
# ============================================================================
elseif ($mode -eq 'docker-whatsapp') {
    Write-Header "DOCKER WHATSAPP-ONLY DEPLOYMENT"

    # Check Docker
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        Write-Error-Custom "Docker not found. Install from https://www.docker.com/"
        exit 1
    }
    Write-Success "Docker found: $(docker --version)"

    Write-Info "This mode runs WhatsApp in Docker while API/DB run locally"
    Write-Info "Make sure API is running on localhost:4000"

    # Build
    if ($rebuild) {
        Write-Info "Building WhatsApp Docker image..."
        docker-compose -f docker-compose.whatsapp-only.yml build --no-cache
        Write-Success "Image built"
    }

    # Start
    Write-Info "Starting WhatsApp container..."
    docker-compose -f docker-compose.whatsapp-only.yml up -d
    Write-Success "Container started"

    Write-Header "✅ WHATSAPP DOCKER DEPLOYMENT COMPLETE"
    Write-Host ""
    Write-Host "WhatsApp running on port 4001" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Useful commands:" -ForegroundColor Cyan
    Write-Host "  docker-compose -f docker-compose.whatsapp-only.yml logs -f" -ForegroundColor Gray
    Write-Host "  docker-compose -f docker-compose.whatsapp-only.yml down" -ForegroundColor Gray
}

# ============================================================================
# PRODUCTION MODE
# ============================================================================
elseif ($mode -eq 'prod') {
    Write-Header "PRODUCTION VPS DEPLOYMENT"

    if (-not $host) {
        Write-Error-Custom "VPS host required. Use: -host user@vps.example.com"
        exit 1
    }

    Write-Info "Target: $host"
    Write-Info "This will deploy the project to your VPS"

    # Verify SSH connection
    Write-Info "Verifying SSH connection..."
    ssh -q $host exit
    if ($LASTEXITCODE -ne 0) {
        Write-Error-Custom "Cannot connect to $host"
        exit 1
    }
    Write-Success "SSH connection OK"

    # Create backup
    Write-Info "Creating backup on VPS..."
    ssh $host "cd /app/sss && tar -czf ../sss-backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').tar.gz ." 2>$null
    Write-Success "Backup created"

    # Upload files
    Write-Info "Uploading project files..."
    scp -r . "$host`:/app/sss/" 2>$null
    Write-Success "Files uploaded"

    # Build and start
    Write-Info "Building on VPS..."
    ssh $host @"
      cd /app/sss/apps/api
      npm install --omit=dev
      npm run build
      npx prisma migrate deploy

      # Start with PM2 or systemd (adjust as needed)
      pm2 start "npm run start:prod" --name sss-api --log-date-format "YYYY-MM-DD HH:mm:ss"
"@

    Write-Success "VPS deployment complete"
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Verify API is running: ssh $host 'pm2 status'" -ForegroundColor Gray
    Write-Host "  2. Check logs: ssh $host 'pm2 logs sss-api'" -ForegroundColor Gray
    Write-Host "  3. Setup reverse proxy (nginx) if not already done" -ForegroundColor Gray
}

Write-Host ""
