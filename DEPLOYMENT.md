# SSS Company - VPS Deployment Guide

**Status:** Production Deployment  
**Date:** 2026-09-01  
**VPS Host:** 187.53.132.7 (VPS KVM 2)  
**Domains:**
- API: https://api.sssfurniture.co.in
- Admin Panel: https://admin.sssfurniture.co.in

---

## 📋 Table of Contents

1. [Initial Deployment](#initial-deployment)
2. [Quick Redeploy (Code Updates)](#quick-redeploy-code-updates)
3. [Architecture](#architecture)
4. [Accessing the VPS](#accessing-the-vps)
5. [Troubleshooting](#troubleshooting)
6. [Monitoring & Logs](#monitoring--logs)

---

## 🚀 Initial Deployment

### Prerequisites
- VPS with SSH access
- Docker & Docker Compose installed
- SSL certificates from Let's Encrypt
- Domains pointing to VPS IP

### One-Command Deployment

```bash
# From your local machine
ssh root@187.53.132.7

# Then run:
bash /root/vps_setup.sh
```

### What Gets Deployed

The deployment script automatically:
1. ✅ Updates system packages
2. ✅ Installs Docker & Docker Compose
3. ✅ Installs Certbot for SSL
4. ✅ Clones from GitHub: https://github.com/anantorix-debug/sss-furniture.git
5. ✅ Configures environment variables
6. ✅ Generates SSL certificates for both domains
7. ✅ Starts all Docker containers
8. ✅ Runs database migrations
9. ✅ Seeds initial data

### Services Running

```
├── MySQL Database (Port 3306)
│   └── Database: sss
│   └── User: root
│   └── Password: root
│
├── NestJS API (Port 4000 - Internal)
│   └── Exposed via: https://api.sssfurniture.co.in
│   └── Health check: /api/auth/me
│
├── Next.js Admin Panel (Port 3000 - Internal)
│   └── Exposed via: https://admin.sssfurniture.co.in
│   └── Login: admin@sss.com / admin123
│
└── Nginx Reverse Proxy (Ports 80, 443)
    └── SSL/TLS termination
    └── Route management
    └── Auto HTTP → HTTPS redirect
```

---

## 🔄 Quick Redeploy (Code Updates)

### Scenario 1: Update API or Web Code Only

```bash
# SSH into VPS
ssh root@187.53.132.7

# Go to project directory
cd /root/sss-furniture

# Pull latest code from GitHub
git pull origin main
# OR checkout specific branch:
# git checkout develop && git pull origin develop

# Rebuild and restart containers
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

# Verify deployment
docker-compose -f docker-compose.prod.yml ps
```

### Scenario 2: Update Database Schema

```bash
cd /root/sss-furniture

# Pull latest changes
git pull origin main

# Update Prisma schema if changed
docker-compose -f docker-compose.prod.yml exec api npx prisma migrate deploy

# Restart API
docker-compose -f docker-compose.prod.yml restart api
```

### Scenario 3: Quick Fix Without Rebuild

```bash
cd /root/sss-furniture

# Just restart containers (if only env vars changed)
docker-compose -f docker-compose.prod.yml restart api web

# Or restart specific service
docker-compose -f docker-compose.prod.yml restart api
```

### Scenario 4: Full Reboot (Latest Code)

```bash
cd /root/sss-furniture

# Stop all containers
docker-compose -f docker-compose.prod.yml down

# Pull latest code
git pull origin main

# Rebuild everything
docker-compose -f docker-compose.prod.yml build --no-cache

# Start services
docker-compose -f docker-compose.prod.yml up -d

# Wait for DB to be ready
sleep 10

# Run migrations
docker-compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy

# Check status
docker-compose -f docker-compose.prod.yml ps
```

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────┐
│         Public Internet (HTTPS)                     │
│  api.sssfurniture.co.in : admin.sssfurniture.co.in │
└────────────────────┬────────────────────────────────┘
                     │
                     ▼
        ┌────────────────────────┐
        │   Nginx Reverse Proxy  │
        │   (Ports 80, 443)      │
        │   SSL/TLS Termination  │
        └─────────┬──────────────┘
                  │
        ┌─────────┴──────────────┬────────────┐
        │                        │            │
        ▼                        ▼            ▼
   ┌─────────┐          ┌──────────┐    ┌──────────┐
   │  MySQL  │          │  NestJS  │    │  Next.js │
   │Database │          │   API    │    │   Web    │
   │ :3306   │          │ :4000    │    │ :3000    │
   └─────────┘          └──────────┘    └──────────┘
       │                    │                 │
       └────────────────────┴─────────────────┘
              Docker Network (sss_network)
```

---

## 🔐 Accessing the VPS

### SSH Login
```bash
ssh root@187.53.132.7
# Password: Anantorix@2026
```

### View Logs

```bash
# All services
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f

# Specific service
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f api
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f web
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f db

# Last 100 lines
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs --tail=100 api
```

### Check Container Status

```bash
cd /root/sss-furniture
docker-compose -f docker-compose.prod.yml ps

# Expected output:
# NAME                 COMMAND                  SERVICE      STATUS       PORTS
# sss-furniture-db-1   "docker-entrypoint.s…"   db           Up 2 hours   3306/tcp
# sss-furniture-api-1  "node dist/main.js"      api          Up 2 hours   4000/tcp
# sss-furniture-web-1  "npm start"              web          Up 2 hours   3000/tcp
# sss-furniture-nginx-1 "nginx -g daemon off"   nginx        Up 2 hours   0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
```

### Test API Health

```bash
curl -X GET https://api.sssfurniture.co.in/api/auth/me \
  -H "Authorization: Bearer invalid_token"

# Should return: "Unauthorized" (401 is normal - no token)
# If you get: "Connection refused" - API is down
```

### Access Database from VPS

```bash
# Connect to MySQL container
docker-compose -f /root/sss-furniture/docker-compose.prod.yml exec db mysql -uroot -proot -D sss

# Example queries:
# SELECT COUNT(*) FROM User;
# SELECT * FROM CustomerOrder LIMIT 5;
```

---

## 🛠️ Troubleshooting

### Issue: "Connection refused" on API endpoint

**Diagnosis:**
```bash
cd /root/sss-furniture
docker-compose -f docker-compose.prod.yml ps
# Check if api container is running

docker-compose -f docker-compose.prod.yml logs api
# Check for errors
```

**Solution:**
```bash
# Restart API
docker-compose -f docker-compose.prod.yml restart api

# Or rebuild
docker-compose -f docker-compose.prod.yml build api
docker-compose -f docker-compose.prod.yml up -d api
```

### Issue: Database connection fails

**Diagnosis:**
```bash
docker-compose -f docker-compose.prod.yml logs db

# Check if DB is ready
docker-compose -f docker-compose.prod.yml exec db \
  mysqladmin ping -uroot -proot
```

**Solution:**
```bash
# Wait 30 seconds and restart
sleep 30
docker-compose -f docker-compose.prod.yml restart api
```

### Issue: SSL Certificate Error

**Diagnosis:**
```bash
# Check certificate expiry
curl -vI https://api.sssfurniture.co.in 2>&1 | grep -A2 "certificate"
```

**Solution:**
```bash
# Renew certificates
certbot renew --dry-run  # Test first
certbot renew             # Actually renew

# Restart nginx
docker-compose -f docker-compose.prod.yml restart nginx
```

### Issue: WhatsApp not connecting

**Diagnosis:**
```bash
curl -X GET https://api.sssfurniture.co.in/api/whatsapp/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Should return operational: false until WhatsApp is scanned
```

**Solution:**
1. Go to: https://admin.sssfurniture.co.in/settings/whatsapp
2. Click "Connect WhatsApp"
3. Scan QR code with phone
4. Confirm login

---

## 📊 Monitoring & Logs

### Continuous Monitoring

```bash
# Watch containers in real-time
watch -n 2 'cd /root/sss-furniture && \
  docker-compose -f docker-compose.prod.yml ps'

# Watch API logs
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f api

# Watch all logs with timestamps
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f --timestamps
```

### Database Backup

```bash
# Backup database
docker-compose -f /root/sss-furniture/docker-compose.prod.yml exec -T db \
  mysqldump -uroot -proot sss > /root/sss-backup-$(date +%Y%m%d-%H%M%S).sql

# List backups
ls -lh /root/sss-backup-*.sql
```

### Disk Space

```bash
# Check disk usage
df -h

# Docker images
docker images

# Remove old images
docker image prune -a --force
```

---

## 📝 Environment Variables

### API Environment (`.env`)

```bash
DATABASE_URL=mysql://root:root@db:3306/sss
NODE_ENV=production
JWT_ACCESS_SECRET=your-secret-key-change-this
JWT_ACCESS_EXPIRES_IN=15m
CORS_ORIGIN=https://admin.sssfurniture.co.in
WHATSAPP_ENABLED=true
WHATSAPP_MIN_DELAY_MS=4000
WHATSAPP_MAX_DELAY_MS=9000
```

### Web Environment (`.env.local`)

```bash
NEXT_PUBLIC_API_URL=https://api.sssfurniture.co.in/api
```

### To Update Environment Variables

```bash
# Edit .env file
nano /root/sss-furniture/apps/api/.env

# Restart API
docker-compose -f /root/sss-furniture/docker-compose.prod.yml restart api
```

---

## 🔄 GitHub Branches

### Available Branches

- **main** - Production code (currently deployed)
- **develop** - Staging/testing branch
- **adminpanel** - Frontend-only branch
- **api** - Backend-only branch

### Switch Branch

```bash
cd /root/sss-furniture

# View current branch
git branch

# Switch to develop
git checkout develop
git pull origin develop

# Rebuild and redeploy
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
```

---

## 📞 Support

For issues, check:
1. Logs: `docker-compose logs -f`
2. GitHub: https://github.com/anantorix-debug/sss-furniture
3. Domains DNS: Verify A record points to 187.53.132.7

---

## ✅ Deployment Checklist

- [x] VPS access configured (SSH)
- [x] Docker installed
- [x] GitHub repository cloned
- [x] Environment variables configured
- [x] SSL certificates generated
- [x] Nginx reverse proxy running
- [x] Database initialized
- [x] API container running
- [x] Web container running
- [x] Both domains accessible via HTTPS

**Deployment Status: ✅ ACTIVE**

