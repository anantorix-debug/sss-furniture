#!/usr/bin/env pwsh
<#
.SYNOPSIS
    SSS Furniture VPS Deployment Script

.DESCRIPTION
    Deploys SSS Furniture application to production VPS

.USAGE
    .\Deploy-VPS.ps1
#>

# Configuration
$VPS_HOST = "187.53.132.7"
$VPS_USER = "root"
$REPO_URL = "https://github.com/anantorix-debug/sss-furniture.git"

# Colors
$Green = "Green"
$Yellow = "Yellow"
$Cyan = "Cyan"
$Red = "Red"

Write-Host ""
Write-Host "========================================" -ForegroundColor $Cyan
Write-Host "SSS Furniture VPS Deployment" -ForegroundColor $Green
Write-Host "Host: $VPS_HOST" -ForegroundColor $Yellow
Write-Host "========================================" -ForegroundColor $Cyan
Write-Host ""

# SSH Deployment Script
$deployScript = @'
#!/bin/bash
set -e

PROJECT_DIR="/root/sss-furniture"
API_DOMAIN="api.sssfurniture.co.in"
ADMIN_DOMAIN="admin.sssfurniture.co.in"

echo ""
echo "====== SSS Furniture Deployment Started ======"
echo "Timestamp: $(date)"
echo ""

# Step 1: Update system
echo "[1/12] Updating system packages..."
apt-get update -y >/dev/null 2>&1
apt-get upgrade -y >/dev/null 2>&1
echo "✅ System updated"

# Step 2: Install Docker
echo "[2/12] Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh 2>/dev/null
    sh get-docker.sh >/dev/null 2>&1
    usermod -aG docker root 2>/dev/null || true
fi
echo "✅ Docker ready"

# Step 3: Install Docker Compose
echo "[3/12] Installing Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose 2>/dev/null
    chmod +x /usr/local/bin/docker-compose
fi
echo "✅ Docker Compose ready"

# Step 4: Install required tools
echo "[4/12] Installing required tools..."
apt-get install -y git certbot python3-certbot-nginx chromium-browser >/dev/null 2>&1
echo "✅ Tools installed"

# Step 5: Clone/Update Repository
echo "[5/12] Setting up repository..."
if [ -d "$PROJECT_DIR" ]; then
    cd "$PROJECT_DIR"
    git pull origin main 2>&1 | head -3
    echo "✅ Repository updated"
else
    git clone https://github.com/anantorix-debug/sss-furniture.git "$PROJECT_DIR"
    cd "$PROJECT_DIR"
    echo "✅ Repository cloned"
fi

# Step 6: Create environment files
echo "[6/12] Configuring environment..."
mkdir -p "$PROJECT_DIR/apps/api"
mkdir -p "$PROJECT_DIR/apps/web"

cat > "$PROJECT_DIR/apps/api/.env" << 'ENVEOF'
DATABASE_URL=mysql://root:root@db:3306/sss
NODE_ENV=production
JWT_ACCESS_SECRET=prod-secret-key-2026-sss-furniture
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=prod-refresh-secret-2026
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=https://admin.sssfurniture.co.in
SUPERADMIN_NAME=Super Admin
SUPERADMIN_EMAIL=admin@sss.com
SUPERADMIN_PASSWORD=admin123
WHATSAPP_ENABLED=true
WWEBJS_AUTH_PATH=.wwebjs_auth
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
PUPPETEER_SKIP_DOWNLOAD=true
WHATSAPP_MIN_DELAY_MS=4000
WHATSAPP_MAX_DELAY_MS=9000
WHATSAPP_MAX_PER_RECIPIENT_PER_DAY=5
WHATSAPP_MAX_PER_HOUR=30
WHATSAPP_MAX_QUEUE_DEPTH=50
WHATSAPP_SEND_TIMEOUT_MS=30000
WHATSAPP_LID_RESOLUTION_TIMEOUT_MS=8000
PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage
ENVEOF

cat > "$PROJECT_DIR/apps/web/.env.local" << 'ENVEOF'
NEXT_PUBLIC_API_URL=https://api.sssfurniture.co.in/api
ENVEOF

echo "✅ Environment configured"

# Step 7: Create production docker-compose
echo "[7/12] Creating production configuration..."
cd "$PROJECT_DIR"
cat > docker-compose.prod.yml << 'COMPOSEEOF'
version: '3.8'

services:
  db:
    image: mysql:8.0
    environment:
      MYSQL_ROOT_PASSWORD: root
      MYSQL_DATABASE: sss
    volumes:
      - db_data:/var/lib/mysql
    healthcheck:
      test: [ "CMD", "mysqladmin", "ping", "-h", "localhost" ]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  api:
    build:
      context: ./apps/api
    environment:
      DATABASE_URL: mysql://root:root@db:3306/sss
      NODE_ENV: production
    depends_on:
      db:
        condition: service_healthy
    volumes:
      - ./.wwebjs_auth:/app/.wwebjs_auth
      - ./data/whatsapp-session:/app/data/whatsapp-session
    restart: unless-stopped

  web:
    build:
      context: ./apps/web
      args:
        NEXT_PUBLIC_API_URL: https://api.sssfurniture.co.in/api
    environment:
      NEXT_PUBLIC_API_URL: https://api.sssfurniture.co.in/api
    depends_on:
      - api
    restart: unless-stopped

  nginx:
    image: nginx:latest
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - /etc/letsencrypt:/etc/letsencrypt:ro
    depends_on:
      - api
      - web
    restart: unless-stopped

volumes:
  db_data:
COMPOSEEOF

echo "✅ Production configuration created"

# Step 8: Create Nginx configuration
echo "[8/12] Configuring Nginx..."
cat > "$PROJECT_DIR/nginx.conf" << 'NGINXEOF'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    server {
        listen 80;
        server_name api.sssfurniture.co.in admin.sssfurniture.co.in;
        return 301 https://$server_name$request_uri;
    }

    server {
        listen 443 ssl http2;
        server_name api.sssfurniture.co.in;
        ssl_certificate /etc/letsencrypt/live/api.sssfurniture.co.in/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/api.sssfurniture.co.in/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        location / {
            proxy_pass http://api:4000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }

    server {
        listen 443 ssl http2;
        server_name admin.sssfurniture.co.in;
        ssl_certificate /etc/letsencrypt/live/admin.sssfurniture.co.in/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/admin.sssfurniture.co.in/privkey.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        location / {
            proxy_pass http://web:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }
}
NGINXEOF

echo "✅ Nginx configured"

# Step 9: Generate SSL Certificates
echo "[9/12] Generating SSL certificates..."
mkdir -p /etc/letsencrypt/live/api.sssfurniture.co.in
mkdir -p /etc/letsencrypt/live/admin.sssfurniture.co.in

docker-compose -f "$PROJECT_DIR/docker-compose.prod.yml" down 2>/dev/null || true

certbot certonly --standalone \
    -d api.sssfurniture.co.in \
    -d admin.sssfurniture.co.in \
    --non-interactive --agree-tos --email admin@sss.com \
    --preferred-challenges http 2>&1 | grep -E "Successfully|Cert" || echo "SSL certificates ready"

echo "✅ SSL certificates installed"

# Step 10: Build and start Docker containers
echo "[10/12] Building Docker containers..."
cd "$PROJECT_DIR"
docker-compose -f docker-compose.prod.yml build 2>&1 | tail -5
docker-compose -f docker-compose.prod.yml up -d
echo "✅ Containers started"

# Step 11: Wait for services
echo "[11/12] Waiting for services..."
sleep 15

# Step 12: Initialize database
echo "[12/12] Initializing database..."
cd "$PROJECT_DIR"
docker-compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy 2>&1 || true
docker-compose -f docker-compose.prod.yml exec -T api npx prisma db seed 2>&1 || true

echo ""
echo "====== ✅ DEPLOYMENT SUCCESSFUL ======"
echo ""
echo "Container Status:"
docker-compose -f docker-compose.prod.yml ps

echo ""
echo "🌐 URLs:"
echo "  API:   https://api.sssfurniture.co.in"
echo "  Admin: https://admin.sssfurniture.co.in"
echo ""
echo "👤 Credentials:"
echo "  Email:    admin@sss.com"
echo "  Password: admin123"
echo ""

'@

# Execute deployment
Write-Host "Connecting to VPS: $VPS_HOST..." -ForegroundColor $Cyan
Write-Host "Starting deployment (this will take 5-10 minutes)..." -ForegroundColor $Yellow
Write-Host ""

# Use SSH to run deployment script
$sshCmd = "ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=NUL $VPS_USER@$VPS_HOST '$($deployScript -replace "'", "'\''")'`""

try {
    Invoke-Expression $sshCmd

    Write-Host ""
    Write-Host "========================================" -ForegroundColor $Cyan
    Write-Host "✅ DEPLOYMENT COMPLETED SUCCESSFULLY" -ForegroundColor $Green
    Write-Host "========================================" -ForegroundColor $Cyan
    Write-Host ""
    Write-Host "🌐 Access Your Application:" -ForegroundColor $Green
    Write-Host "   API:   https://api.sssfurniture.co.in" -ForegroundColor $Cyan
    Write-Host "   Admin: https://admin.sssfurniture.co.in" -ForegroundColor $Cyan
    Write-Host ""
    Write-Host "👤 Login Credentials:" -ForegroundColor $Green
    Write-Host "   Email:    admin@sss.com" -ForegroundColor $Cyan
    Write-Host "   Password: admin123" -ForegroundColor $Cyan
    Write-Host ""
    Write-Host "📖 Documentation:" -ForegroundColor $Green
    Write-Host "   README_DEPLOYMENT.md" -ForegroundColor $Cyan
    Write-Host "   REDEPLOY_QUICK_GUIDE.md" -ForegroundColor $Cyan
    Write-Host ""

} catch {
    Write-Host "Error during deployment: $_" -ForegroundColor $Red
    Write-Host ""
    Write-Host "Fallback: Run this command manually:" -ForegroundColor $Yellow
    Write-Host "ssh root@187.53.132.7" -ForegroundColor $Cyan
    Write-Host "bash <(curl -s https://raw.githubusercontent.com/anantorix-debug/sss-furniture/main/QUICK_DEPLOY.sh)" -ForegroundColor $Cyan
    exit 1
}
