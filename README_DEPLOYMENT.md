# SSS Furniture - Complete VPS Deployment Guide

**Project:** SSS Company WhatsApp Integration & Admin Panel  
**Deployment Date:** 2026-09-01  
**VPS Host:** 187.53.132.7 (KVM 2)  
**Status:** ✅ Production Ready

---

## 📋 Quick Reference

| Component | URL | Credentials |
|-----------|-----|-------------|
| **API** | https://api.sssfurniture.co.in | JWT Token Required |
| **Admin Panel** | https://admin.sssfurniture.co.in | admin@sss.com / admin123 |
| **Database** | Internal (MySQL 8.0) | root:root |
| **SSH Access** | root@187.53.132.7 | Anantorix@2026 |

---

## 🚀 INITIAL DEPLOYMENT (First Time Setup)

### 1️⃣ SSH into VPS

```bash
ssh root@187.53.132.7
# Password: Anantorix@2026
```

### 2️⃣ Run Automated Deployment Script

Copy and run this single command on the VPS:

```bash
bash <(curl -s https://raw.githubusercontent.com/anantorix-debug/sss-furniture/main/QUICK_DEPLOY.sh)
```

**OR** if you prefer step-by-step manual setup, see [Manual Deployment Steps](#manual-deployment-steps-alternative) below.

### 3️⃣ Verify Deployment

After the script completes (takes 5-10 minutes):

```bash
# Check container status
docker-compose -f /root/sss-furniture/docker-compose.prod.yml ps

# Test API
curl https://api.sssfurniture.co.in/api/auth/me

# View logs (if needed)
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f
```

### ✅ Success Indicators

- ✅ All 4 containers running: `db`, `api`, `web`, `nginx`
- ✅ SSL certificates installed for both domains
- ✅ Database initialized and seeded
- ✅ Admin panel accessible at https://admin.sssfurniture.co.in
- ✅ API responding at https://api.sssfurniture.co.in

---

## 🔄 REDEPLOYMENT (Code Changes Only)

### Scenario A: Deploy Latest Main Branch Code

```bash
ssh root@187.53.132.7

cd /root/sss-furniture

# Pull latest code
git pull origin main

# Rebuild and restart containers
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

# Verify
docker-compose -f docker-compose.prod.yml ps
```

**⏱️ Time:** ~3-5 minutes

### Scenario B: Deploy Specific Branch

```bash
ssh root@187.53.132.7

cd /root/sss-furniture

# Checkout branch
git checkout develop  # or api, adminpanel, etc
git pull origin develop

# Rebuild
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
```

### Scenario C: Database Schema Changes

```bash
ssh root@187.53.132.7

cd /root/sss-furniture

# Pull latest code
git pull origin main

# Run Prisma migrations
docker-compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy

# Restart API if needed
docker-compose -f docker-compose.prod.yml restart api
```

### Scenario D: Quick Code Change (No Database Schema Change)

```bash
cd /root/sss-furniture

# Pull latest
git pull origin main

# Just rebuild the service (e.g., API)
docker-compose -f docker-compose.prod.yml build api
docker-compose -f docker-compose.prod.yml up -d api

# Or for web
docker-compose -f docker-compose.prod.yml build web
docker-compose -f docker-compose.prod.yml up -d web
```

### Scenario E: Full Clean Redeployment

If you encounter issues or want a complete restart:

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

# Wait for DB
sleep 10

# Run migrations
docker-compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy

# Seed data (if needed)
docker-compose -f docker-compose.prod.yml exec -T api npx prisma db seed

# Verify
docker-compose -f docker-compose.prod.yml ps
```

---

## 📁 Project Structure on VPS

```
/root/sss-furniture/
├── apps/
│   ├── api/
│   │   ├── Dockerfile
│   │   ├── .env                 # API environment variables
│   │   └── src/                 # NestJS source code
│   └── web/
│       ├── Dockerfile
│       ├── .env.local            # Web environment variables
│       └── pages/                # Next.js pages
├── docker-compose.prod.yml       # Production compose file
├── nginx.conf                     # Nginx reverse proxy config
├── .git/                          # Git repository
└── data/
    └── whatsapp-session/         # WhatsApp session storage
```

---

## 🔐 Access & Credentials

### SSH Access
```bash
ssh root@187.53.132.7
# Password: Anantorix@2026
```

### Admin Panel Login
- **URL:** https://admin.sssfurniture.co.in
- **Email:** admin@sss.com
- **Password:** admin123

### Database Access (from VPS)
```bash
docker-compose -f /root/sss-furniture/docker-compose.prod.yml exec db mysql -uroot -proot -D sss

# Example queries:
# SELECT COUNT(*) FROM User;
# SELECT * FROM CustomerOrder LIMIT 5;
```

### Environment Variables

**API (.env):**
```
DATABASE_URL=mysql://root:root@db:3306/sss
NODE_ENV=production
JWT_ACCESS_SECRET=prod-secret-key-2026-sss-furniture-change-this
JWT_ACCESS_EXPIRES_IN=15m
CORS_ORIGIN=https://admin.sssfurniture.co.in
SUPERADMIN_EMAIL=admin@sss.com
WHATSAPP_ENABLED=true
WHATSAPP_MIN_DELAY_MS=4000
WHATSAPP_MAX_DELAY_MS=9000
```

**Web (.env.local):**
```
NEXT_PUBLIC_API_URL=https://api.sssfurniture.co.in/api
```

---

## 🛠️ Troubleshooting

### Issue: "Connection refused" on API

```bash
# Check if API container is running
docker-compose -f /root/sss-furniture/docker-compose.prod.yml ps

# View API logs
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs api

# Restart API
docker-compose -f /root/sss-furniture/docker-compose.prod.yml restart api
```

### Issue: Database connection fails

```bash
# Check database logs
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs db

# Verify DB is running
docker-compose -f /root/sss-furniture/docker-compose.prod.yml exec db mysqladmin ping -uroot -proot

# Wait 30 seconds and restart API
sleep 30 && docker-compose -f /root/sss-furniture/docker-compose.prod.yml restart api
```

### Issue: SSL Certificate Error

```bash
# Check certificate
curl -vI https://api.sssfurniture.co.in 2>&1 | grep "certificate"

# Renew certificates
certbot renew --dry-run  # Test first
certbot renew             # Actually renew

# Restart nginx
docker-compose -f /root/sss-furniture/docker-compose.prod.yml restart nginx
```

### Issue: Ports already in use

```bash
# List what's using ports 80, 443
netstat -tlnp | grep -E ':80|:443'

# Stop conflicting containers
docker-compose -f /root/sss-furniture/docker-compose.prod.yml down
docker system prune -f

# Then restart
docker-compose -f docker-compose.prod.yml up -d
```

### Issue: Container build fails

```bash
# Clean up Docker
docker system prune -a -f
docker image prune -a -f

# Remove old volume
docker volume prune -f

# Try again
cd /root/sss-furniture
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

---

## 📊 Monitoring & Logs

### View Live Logs

```bash
# All services
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f

# Specific service
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f api
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f web
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f db
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f nginx

# Last N lines
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs --tail=50 api

# With timestamps
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f --timestamps
```

### Container Status

```bash
cd /root/sss-furniture
docker-compose -f docker-compose.prod.yml ps

# Expected output:
# NAME                  COMMAND                SERVICE    STATUS      PORTS
# sss-furniture-db-1    "docker-entrypoint..." db         Up 2 hours   3306/tcp
# sss-furniture-api-1   "node dist/main.js"    api        Up 2 hours   4000/tcp
# sss-furniture-web-1   "npm start"            web        Up 2 hours   3000/tcp
# sss-furniture-nginx-1 "nginx -g daemon..."   nginx      Up 2 hours   0.0.0.0:80->80, 0.0.0.0:443->443
```

### Resource Usage

```bash
# CPU and memory usage
docker stats

# Disk space
df -h

# Docker volumes
docker volume ls

# Docker images
docker images
```

### Database Backup

```bash
# Create backup
docker-compose -f /root/sss-furniture/docker-compose.prod.yml exec -T db \
  mysqldump -uroot -proot sss > /root/sss-backup-$(date +%Y%m%d-%H%M%S).sql

# List backups
ls -lh /root/sss-backup-*.sql

# Restore from backup
docker-compose -f /root/sss-furniture/docker-compose.prod.yml exec -T db \
  mysql -uroot -proot sss < /root/sss-backup-20260901-120000.sql
```

---

## 🔄 Architecture

```
Internet (HTTPS)
    ↓
┌─────────────────────────┐
│  Nginx Reverse Proxy    │
│  (Ports 80, 443)        │
│  SSL/TLS Termination    │
└──────────┬──────────────┘
           │
    ┌──────┴──────┬─────────┐
    ↓             ↓         ↓
┌────────┐  ┌────────┐  ┌────────┐
│ MySQL  │  │ NestJS │  │ Next.js│
│Database│  │  API   │  │  Web   │
│:3306   │  │ :4000  │  │ :3000  │
└────────┘  └────────┘  └────────┘
    ↑            ↑          ↑
└────────────────────────────┘
     Docker Network (bridge)
```

---

## 🌐 DNS Configuration

Both domains should point to your VPS IP:

```
api.sssfurniture.co.in      → 185.230.63.107 (A record, 1 hour TTL)
admin.sssfurniture.co.in    → 185.230.63.107 (A record, 1 hour TTL)
```

**Current Status:** ✅ Both domains pointing to correct IP

---

## 📦 Available Branches

Deploy from any of these Git branches:

- **main** - Production code (default)
- **develop** - Staging/testing
- **api** - Backend-only changes
- **adminpanel** - Frontend-only changes

Switch branches:
```bash
cd /root/sss-furniture
git checkout develop
git pull origin develop
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
```

---

## 🚨 Emergency Procedures

### Stop All Services (Emergency)

```bash
docker-compose -f /root/sss-furniture/docker-compose.prod.yml down
```

### Restart All Services

```bash
docker-compose -f /root/sss-furniture/docker-compose.prod.yml up -d
```

### Clear Docker Cache & Rebuild

```bash
cd /root/sss-furniture
docker-compose -f docker-compose.prod.yml down
docker system prune -a -f
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

### View System Logs

```bash
# Docker daemon logs
journalctl -u docker -f

# System messages
dmesg | tail -50

# Disk full?
df -h
du -sh /root/*
```

---

## ✅ Pre-Deployment Checklist

Before deploying any code changes:

- [ ] Code is tested locally
- [ ] All tests pass (`npm test`)
- [ ] Database migrations are reviewed (if any)
- [ ] Environment variables are correct
- [ ] Branch is up to date with main
- [ ] Code is merged to deployment branch

### Post-Deployment Checklist

After deploying:

- [ ] All containers are running: `docker-compose ps`
- [ ] API responds: `curl https://api.sssfurniture.co.in/api/auth/me`
- [ ] Admin panel loads: Open https://admin.sssfurniture.co.in
- [ ] Login works with admin credentials
- [ ] Check logs for errors: `docker-compose logs -f`
- [ ] Database queries work: Test from admin panel

---

## 📞 Support & Help

### Quick Reference Commands

```bash
# Connect to VPS
ssh root@187.53.132.7

# Navigate to project
cd /root/sss-furniture

# View all logs
docker-compose -f docker-compose.prod.yml logs -f

# Check status
docker-compose -f docker-compose.prod.yml ps

# Redeploy
git pull origin main && \
docker-compose -f docker-compose.prod.yml build && \
docker-compose -f docker-compose.prod.yml up -d

# Database backup
docker-compose -f docker-compose.prod.yml exec -T db \
  mysqldump -uroot -proot sss > backup-$(date +%Y%m%d).sql
```

### GitHub Repository

https://github.com/anantorix-debug/sss-furniture

### Key Files

- **VPS Manual Guide:** VPS_DEPLOYMENT_MANUAL.md
- **Quick Redeploy Guide:** REDEPLOY_QUICK_GUIDE.md
- **Full Deployment Info:** DEPLOYMENT.md
- **This File:** README_DEPLOYMENT.md

---

## 📝 Deployment Log

| Date | Action | Status |
|------|--------|--------|
| 2026-09-01 | Initial deployment | ✅ Complete |
| | SSL certificates installed | ✅ Complete |
| | Database initialized | ✅ Complete |
| | All services running | ✅ Complete |

---

**Last Updated:** 2026-09-01  
**Deployment Status:** ✅ ACTIVE  
**All Systems:** ✅ OPERATIONAL

