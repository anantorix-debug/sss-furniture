#!/bin/bash
# Quick Deployment Script for VPS
# Run this on your VPS after SSH login

set -e

PROJECT_DIR="/root/sss-furniture"
API_DOMAIN="api.sssfurniture.co.in"
ADMIN_DOMAIN="admin.sssfurniture.co.in"

echo "====== SSS Furniture Deployment ======"
echo ""

# Step 1: Update system
echo "[1/11] Updating system..."
apt-get update -y > /dev/null
apt-get upgrade -y > /dev/null
echo "✅ System updated"

# Step 2: Install Docker
echo "[2/11] Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh > /dev/null 2>&1
    usermod -aG docker root
    echo "✅ Docker installed"
else
    echo "✅ Docker already installed"
fi

# Step 3: Install Docker Compose
echo "[3/11] Installing Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose 2>/dev/null
    chmod +x /usr/local/bin/docker-compose
    echo "✅ Docker Compose installed"
else
    echo "✅ Docker Compose already installed"
fi

# Step 4: Install Certbot
echo "[4/11] Installing Certbot..."
apt-get install -y certbot python3-certbot-nginx > /dev/null 2>&1
echo "✅ Certbot installed"

# Step 5: Install Git
echo "[5/11] Installing Git..."
apt-get install -y git > /dev/null 2>&1
echo "✅ Git installed"

# Step 6: Clone/Update Repository
echo "[6/11] Cloning repository..."
if [ -d "$PROJECT_DIR" ]; then
    cd "$PROJECT_DIR"
    git pull origin main
    echo "✅ Repository updated"
else
    git clone https://github.com/anantorix-debug/sss-furniture.git "$PROJECT_DIR"
    cd "$PROJECT_DIR"
    echo "✅ Repository cloned"
fi

# Step 7: Create environment files
echo "[7/11] Configuring environment..."
cd "$PROJECT_DIR/apps/api"

cat > .env << 'EOF'
DATABASE_URL=mysql://root:root@db:3306/sss
NODE_ENV=production
JWT_ACCESS_SECRET=prod-secret-key-2026-change-this
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=prod-refresh-secret-2026
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=https://admin.sssfurniture.co.in
SUPERADMIN_NAME=Super Admin
SUPERADMIN_EMAIL=admin@sss.com
SUPERADMIN_PASSWORD=ChangeMe123!
WHATSAPP_ENABLED=true
WWEBJS_AUTH_PATH=.wwebjs_auth
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
PUPPETEER_SKIP_DOWNLOAD=true
WHATSAPP_MIN_DELAY_MS=4000
WHATSAPP_MAX_DELAY_MS=9000
PUPPETEER_ARGS=--no-sandbox,--disable-setuid-sandbox,--disable-dev-shm-usage
EOF

cd "$PROJECT_DIR/apps/web"
cat > .env.local << 'EOF'
NEXT_PUBLIC_API_URL=https://api.sssfurniture.co.in/api
EOF

echo "✅ Environment configured"

# Step 8: Create Docker Compose production override
echo "[8/11] Creating production configuration..."
cd "$PROJECT_DIR"

cat > docker-compose.prod.yml << 'EOF'
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
EOF

echo "✅ Production configuration created"

# Step 9: Create Nginx configuration
echo "[9/11] Configuring Nginx..."

cat > nginx.conf << 'NGINX_EOF'
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
NGINX_EOF

echo "✅ Nginx configured"

# Step 10: Get SSL Certificates
echo "[10/11] Setting up SSL certificates..."
mkdir -p /etc/letsencrypt/live/api.sssfurniture.co.in
mkdir -p /etc/letsencrypt/live/admin.sssfurniture.co.in

certbot certonly --standalone \
    -d api.sssfurniture.co.in \
    -d admin.sssfurniture.co.in \
    --non-interactive --agree-tos --email admin@sss.com --preferred-challenges http || true

echo "✅ SSL configured"

# Step 11: Start containers
echo "[11/11] Starting Docker containers..."
cd "$PROJECT_DIR"
docker-compose -f docker-compose.prod.yml down || true
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

# Wait for services
sleep 10

# Run migrations
docker-compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy || true
docker-compose -f docker-compose.prod.yml exec -T api npx prisma db seed || true

echo ""
echo "====== ✅ DEPLOYMENT COMPLETE ======"
echo ""
echo "URLs:"
echo "  API:   https://api.sssfurniture.co.in"
echo "  Admin: https://admin.sssfurniture.co.in"
echo ""
echo "Login:"
echo "  Email:    admin@sss.com"
echo "  Password: admin123"
echo ""
echo "View logs:  docker-compose -f docker-compose.prod.yml logs -f"
echo "Container status: docker-compose -f docker-compose.prod.yml ps"
echo ""
