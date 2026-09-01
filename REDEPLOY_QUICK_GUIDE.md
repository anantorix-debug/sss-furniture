# Quick Redeploy Guide - For Code Updates

**When:** You make changes to the code and push to GitHub  
**Time Required:** 2-5 minutes  
**Downtime:** ~30 seconds

---

## 🚀 Scenario 1: Update Frontend (Admin Panel) Only

Your changes are in the frontend code (React/Next.js)

```bash
# SSH into VPS
ssh root@187.53.132.7

# Go to project directory
cd /root/sss-furniture

# Get latest code
git pull origin main

# Rebuild and restart web container
docker-compose -f docker-compose.prod.yml build web
docker-compose -f docker-compose.prod.yml up -d web

# Verify
docker-compose -f docker-compose.prod.yml ps
```

**Check:** https://admin.sssfurniture.co.in

---

## 🔌 Scenario 2: Update Backend (API) Only

Your changes are in the API code (NestJS)

```bash
ssh root@187.53.132.7
cd /root/sss-furniture

git pull origin main

# Rebuild and restart API container
docker-compose -f docker-compose.prod.yml build api
docker-compose -f docker-compose.prod.yml up -d api

# Verify
docker-compose -f docker-compose.prod.yml ps
```

**Check:** 
```bash
curl -X GET https://api.sssfurniture.co.in/api/auth/me
```

---

## 📊 Scenario 3: Database Schema Changes

You changed the Prisma schema (added new fields, tables, etc.)

```bash
ssh root@187.53.132.7
cd /root/sss-furniture

git pull origin main

# Deploy database migrations
docker-compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy

# Rebuild API (if you also changed code)
docker-compose -f docker-compose.prod.yml build api

# Restart
docker-compose -f docker-compose.prod.yml restart api

# Verify
docker-compose -f docker-compose.prod.yml logs api
```

---

## 🔄 Scenario 4: Update Both Frontend & Backend

You changed both API and web code

```bash
ssh root@187.53.132.7
cd /root/sss-furniture

git pull origin main

# Full rebuild
docker-compose -f docker-compose.prod.yml build

# Restart all
docker-compose -f docker-compose.prod.yml up -d

# Check logs
docker-compose -f docker-compose.prod.yml logs -f
```

---

## ⚙️ Scenario 5: Environment Variables Changed

You updated .env file for API configuration

```bash
ssh root@187.53.132.7
cd /root/sss-furniture/apps/api

# Edit .env file
nano .env

# Make your changes, then press: Ctrl+X, Y, Enter

# Restart API
cd /root/sss-furniture
docker-compose -f docker-compose.prod.yml restart api

# Verify
docker-compose -f docker-compose.prod.yml logs api
```

---

## 🎯 Scenario 6: Emergency Rollback to Previous Version

Something broke! Roll back to previous code

```bash
ssh root@187.53.132.7
cd /root/sss-furniture

# See commit history
git log --oneline -10

# Rollback to previous commit (example: abc123d)
git revert abc123d
# OR hard rollback
git reset --hard abc123d

# Rebuild and redeploy
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

# Verify
docker-compose -f docker-compose.prod.yml ps
```

---

## 🌳 Scenario 7: Deploy from Different Branch

Deploy from `develop` or `api` branch instead of `main`

```bash
ssh root@187.53.132.7
cd /root/sss-furniture

# Switch to develop branch
git checkout develop
git pull origin develop

# Rebuild and deploy
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

# Switch back to main when done
git checkout main
git pull origin main
```

---

## 📋 Complete Redeploy (Nuclear Option)

Start fresh - stop everything, clean up, redeploy

```bash
ssh root@187.53.132.7
cd /root/sss-furniture

# Stop all containers
docker-compose -f docker-compose.prod.yml down

# Get latest code
git pull origin main

# Rebuild everything fresh
docker-compose -f docker-compose.prod.yml build --no-cache

# Start services
docker-compose -f docker-compose.prod.yml up -d

# Wait 10 seconds for DB to initialize
sleep 10

# Run migrations
docker-compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy

# Seed data if needed
docker-compose -f docker-compose.prod.yml exec -T api npx prisma db seed

# Check status
docker-compose -f docker-compose.prod.yml ps
```

---

## 🔍 Verify After Deployment

```bash
# Check all containers are running
docker-compose -f /root/sss-furniture/docker-compose.prod.yml ps

# Should see:
# - db     RUNNING
# - api    RUNNING
# - web    RUNNING
# - nginx  RUNNING

# Test API
curl -X GET https://api.sssfurniture.co.in/api/auth/me

# Should return: {"message":"Unauthorized"} (401 is OK)

# Check frontend
curl -I https://admin.sssfurniture.co.in

# Should return: HTTP/2 200
```

---

## 📊 View Logs During Deployment

```bash
# Real-time logs
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f

# Specific service logs
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f api
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f web

# Last 100 lines
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs --tail=100 api

# Exit: Press Ctrl+C
```

---

## ⚡ TL;DR - Quick Copy-Paste Commands

### Update Frontend Only
```bash
ssh root@187.53.132.7 && cd /root/sss-furniture && git pull && docker-compose -f docker-compose.prod.yml build web && docker-compose -f docker-compose.prod.yml up -d web
```

### Update Backend Only
```bash
ssh root@187.53.132.7 && cd /root/sss-furniture && git pull && docker-compose -f docker-compose.prod.yml build api && docker-compose -f docker-compose.prod.yml up -d api
```

### Update Everything
```bash
ssh root@187.53.132.7 && cd /root/sss-furniture && git pull && docker-compose -f docker-compose.prod.yml build && docker-compose -f docker-compose.prod.yml up -d
```

---

## 🆘 If Something Goes Wrong

### Containers not starting
```bash
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs
# Look for error messages
```

### API returning 502 Bad Gateway
```bash
# API container might be crashed
docker-compose -f /root/sss-furniture/docker-compose.prod.yml restart api
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs api
```

### Database connection error
```bash
# Wait and retry
sleep 30
docker-compose -f /root/sss-furniture/docker-compose.prod.yml restart api
```

### Full reset needed
```bash
cd /root/sss-furniture
docker-compose -f docker-compose.prod.yml down
docker system prune -a -f
git pull origin main
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

---

## 📞 Remember

- **API URL:** https://api.sssfurniture.co.in
- **Admin URL:** https://admin.sssfurniture.co.in
- **SSH:** root@187.53.132.7
- **Project Dir:** /root/sss-furniture
- **Compose File:** docker-compose.prod.yml

---

**Questions?** Check `DEPLOYMENT.md` for detailed troubleshooting

