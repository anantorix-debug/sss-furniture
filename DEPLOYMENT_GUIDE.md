# SSS Furniture - Deployment Guide

Your DNS is configured with multiple A records pointing to different IPs. This guide provides step-by-step deployment instructions using Git and Docker.

## DNS Configuration (Already Verified ✓)

```
sssfurniture.co.in         → 185.230.63.171 (1 Hour TTL)
sssfurniture.co.in         → 185.230.63.186 (1 Hour TTL)
sssfurniture.co.in         → 185.230.63.107 (1 Hour TTL)
api.sssfurniture.co.in     → 187.53.132.7   (1 Hour TTL)
admin.sssfurniture.co.in   → 187.53.132.7   (1 Hour TTL)
```

---

## STEP 1: Prepare Your VPS

### 1.1 SSH into Your VPS
```bash
ssh root@185.230.63.171
# or any of the other IPs if using load balancer
```

### 1.2 Update System Packages
```bash
apt update && apt upgrade -y
```

### 1.3 Install Docker & Docker Compose
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Install Docker Compose
curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose

# Verify installation
docker --version
docker-compose --version
```

### 1.4 Install Git
```bash
apt install -y git
git --version
```

---

## STEP 2: Clone Your Repository

### 2.1 Clone the Project
```bash
cd /opt
git clone https://github.com/your-username/your-repo.git sssfurniture
cd sssfurniture
```

### 2.2 Verify Git Status
```bash
git status
git log --oneline -5
```

---

## STEP 3: Prepare Environment Variables

### 3.1 Create Production .env Files

**For API (`apps/api/.env`):**
```bash
cat > apps/api/.env << 'EOF'
DATABASE_URL=mysql://root:YOUR_SECURE_PASSWORD@db:3306/sss
NODE_ENV=production
JWT_ACCESS_SECRET=your-very-secure-access-secret-key-here
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your-very-secure-refresh-secret-key-here
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=https://sssfurniture.co.in
SUPERADMIN_NAME=Super Admin
SUPERADMIN_EMAIL=admin@sssfurniture.co.in
SUPERADMIN_PASSWORD=YourSecurePassword123!
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
EOF
```

### 3.2 Secure Permissions
```bash
chmod 600 apps/api/.env
```

---

## STEP 4: Set Up SSL Certificates

### 4.1 Install Certbot
```bash
apt install -y certbot python3-certbot-nginx
```

### 4.2 Generate SSL Certificates
```bash
certbot certonly --standalone -d sssfurniture.co.in -d api.sssfurniture.co.in -d admin.sssfurniture.co.in
```

**Certificate location:** `/etc/letsencrypt/live/sssfurniture.co.in/`

### 4.3 Auto-Renewal Setup
```bash
systemctl enable certbot.timer
systemctl start certbot.timer
```

---

## STEP 5: Configure Nginx

### 5.1 Create Nginx Configuration
```bash
cat > nginx.conf << 'EOF'
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

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 20M;

    # Upstream definitions
    upstream api {
        server api:4000;
    }

    upstream web {
        server web:3000;
    }

    # HTTP to HTTPS redirect
    server {
        listen 80;
        server_name sssfurniture.co.in api.sssfurniture.co.in admin.sssfurniture.co.in;
        return 301 https://$server_name$request_uri;
    }

    # Main website (HTTPS)
    server {
        listen 443 ssl http2;
        server_name sssfurniture.co.in;

        ssl_certificate /etc/letsencrypt/live/sssfurniture.co.in/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/sssfurniture.co.in/privkey.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;

        location / {
            proxy_pass http://web;
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

    # API Server (HTTPS)
    server {
        listen 443 ssl http2;
        server_name api.sssfurniture.co.in;

        ssl_certificate /etc/letsencrypt/live/sssfurniture.co.in/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/sssfurniture.co.in/privkey.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;

        location /api/ {
            proxy_pass http://api/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        location / {
            return 404;
        }
    }

    # Admin Dashboard (HTTPS)
    server {
        listen 443 ssl http2;
        server_name admin.sssfurniture.co.in;

        ssl_certificate /etc/letsencrypt/live/sssfurniture.co.in/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/sssfurniture.co.in/privkey.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;

        location / {
            proxy_pass http://web;
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
EOF
```

---

## STEP 6: Start Docker Containers

### 6.1 Build and Start Services
```bash
# Pull latest changes from git
git pull origin main

# Build Docker images
docker-compose -f docker-compose.prod.yml build

# Start all services
docker-compose -f docker-compose.prod.yml up -d

# Verify services are running
docker-compose -f docker-compose.prod.yml ps
```

### 6.2 Check Service Logs
```bash
# View all logs
docker-compose -f docker-compose.prod.yml logs -f

# View specific service logs
docker-compose -f docker-compose.prod.yml logs -f api
docker-compose -f docker-compose.prod.yml logs -f web
docker-compose -f docker-compose.prod.yml logs -f db
```

---

## STEP 7: Database Setup

### 7.1 Run Database Migrations
```bash
# Access API container
docker-compose -f docker-compose.prod.yml exec api bash

# Inside container, run migrations
npm run prisma:migrate

# Exit container
exit
```

### 7.2 Verify Database Connection
```bash
docker-compose -f docker-compose.prod.yml exec db mysql -u root -p$MYSQL_ROOT_PASSWORD -e "USE sss; SHOW TABLES;"
```

---

## STEP 8: Health Checks

### 8.1 Test API Health
```bash
curl https://api.sssfurniture.co.in/api/health
```

Expected response: `{"status":"ok"}`

### 8.2 Test Website
```bash
curl -I https://sssfurniture.co.in
```

Expected: `HTTP/2 200`

### 8.3 Check Docker Container Status
```bash
docker-compose -f docker-compose.prod.yml ps
```

All containers should show `Up` status.

---

## STEP 9: Post-Deployment

### 9.1 Set Up Monitoring
```bash
# Monitor container performance
docker stats
```

### 9.2 Configure Log Rotation
```bash
cat > /etc/logrotate.d/docker-compose << 'EOF'
/var/lib/docker/containers/*/*.log {
    rotate 7
    daily
    compress
    missingok
    delaycompress
    copytruncate
}
EOF
```

### 9.3 Set Up Auto-Start
```bash
# Create systemd service
cat > /etc/systemd/system/docker-compose.service << 'EOF'
[Unit]
Description=Docker Compose Services
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/sssfurniture
ExecStart=/usr/local/bin/docker-compose -f docker-compose.prod.yml up -d
ExecStop=/usr/local/bin/docker-compose -f docker-compose.prod.yml down
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Enable and test
systemctl daemon-reload
systemctl enable docker-compose.service
systemctl start docker-compose.service
```

---

## STEP 10: Git Workflow for Updates

### 10.1 Pull Latest Changes
```bash
cd /opt/sssfurniture
git pull origin main
```

### 10.2 Rebuild and Restart Services
```bash
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

### 10.3 View Deployment Status
```bash
docker-compose -f docker-compose.prod.yml ps
docker-compose -f docker-compose.prod.yml logs -f
```

---

## Troubleshooting

### Services Won't Start
```bash
# Check Docker daemon
systemctl restart docker

# Clear volumes and restart
docker-compose -f docker-compose.prod.yml down -v
docker-compose -f docker-compose.prod.yml up -d
```

### Database Connection Error
```bash
# Check database is healthy
docker-compose -f docker-compose.prod.yml exec db mysqladmin ping -u root -p$MYSQL_ROOT_PASSWORD

# View database logs
docker-compose -f docker-compose.prod.yml logs db
```

### Nginx Certificate Issues
```bash
# Renew SSL certificates
certbot renew --force-renewal

# Reload Nginx
docker-compose -f docker-compose.prod.yml restart nginx
```

### WhatsApp Session Issues
```bash
# Clear WhatsApp authentication
rm -rf .wwebjs_auth/*
docker-compose -f docker-compose.prod.yml restart api
```

---

## Quick Commands Reference

```bash
# Deployment
git pull origin main
docker-compose -f docker-compose.prod.yml up -d

# Monitoring
docker-compose -f docker-compose.prod.yml ps
docker-compose -f docker-compose.prod.yml logs -f

# Stop All Services
docker-compose -f docker-compose.prod.yml down

# Restart Services
docker-compose -f docker-compose.prod.yml restart

# View Resource Usage
docker stats

# Clean Up
docker system prune -a
```

---

## Summary

✓ DNS records verified and connected
✓ All A records point to your VPS IPs
✓ SSL certificates auto-renew every 90 days
✓ Services auto-start on VPS restart
✓ Logs are managed and rotated
✓ Git integration ready for continuous updates

Your deployment is production-ready!
