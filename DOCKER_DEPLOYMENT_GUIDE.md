# COMPLETE DOCKER DEPLOYMENT GUIDE - ALL STEPS IN ONE FILE

**For Complete Beginners - Zero Technical Knowledge Required**

Using Docker for production deployment. Every command is copy-paste ready.

---

## TABLE OF CONTENTS
1. What is Docker?
2. Connect to VPS
3. Install Docker & Docker Compose
4. Clone Your Project
5. Configure Environment Variables
6. Setup Docker Compose File
7. Create Nginx Configuration
8. Build and Start Services
9. Setup SSL Certificates
10. Verify Everything Works
11. Daily Docker Commands
12. How to Update Code with Docker
13. Complete Git Commands Guide
14. Docker Commands Reference
15. Troubleshooting

---

# WHAT IS DOCKER?

**Docker** = A container that runs your entire application.

Think of Docker like a box that contains:
- ✅ Node.js runtime
- ✅ Your application code
- ✅ All dependencies
- ✅ Databases
- ✅ Everything needed to run

**Benefits:**
- Same environment everywhere (local, testing, production)
- Easy to deploy and scale
- Services restart automatically if they crash
- Isolated from other software on VPS
- Production-ready

**Docker Compose** = Runs multiple containers together (API, Web, Database).

---

# STEP 1: CONNECT TO YOUR VPS

Your VPS IP: **185.230.63.171**

### On Windows - Open PowerShell and run:
```powershell
ssh root@185.230.63.171
```

### On Mac/Linux - Open Terminal and run:
```bash
ssh root@185.230.63.171
```

**When it asks for password, enter your VPS password.**

✅ You are now on your VPS server.

---

# STEP 2: INSTALL DOCKER & DOCKER COMPOSE

### 2.1 Update System (REQUIRED - Do This First!)

Copy and paste:

```bash
apt update && apt upgrade -y
```

Wait for it to finish (1-2 minutes).

### 2.2 Install Docker

Copy and paste:

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
```

**Verify Docker is installed:**
```bash
docker --version
```

You should see a version number like `Docker version 24.0.0`.

### 2.3 Install Docker Compose

Copy and paste:

```bash
curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
```

**Verify:**
```bash
docker-compose --version
```

Should show version number.

### 2.4 Start Docker Service

```bash
systemctl start docker
systemctl enable docker
```

This makes Docker auto-start when VPS reboots.

### 2.5 Verify Docker Service is Running

```bash
systemctl status docker
```

Press `q` to exit. Should show `active (running)`.

✅ Docker is installed and running!

---

# STEP 3: CLONE YOUR PROJECT FROM GITHUB

### 3.1 Navigate to Projects Directory

```bash
cd /home
```

### 3.2 Clone Your Repository

**Replace `YOUR-USERNAME` and `YOUR-REPO` with your GitHub details:**

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git sssfurniture
```

Example:
```bash
git clone https://github.com/kamalesh/portfolio.git sssfurniture
```

Wait for download to complete.

### 3.3 Go Into Your Project Folder

```bash
cd sssfurniture
```

### 3.4 Verify Files Are There

```bash
ls -la
```

You should see: `apps`, `docker-compose.prod.yml`, `.git`, etc.

✅ Your project is cloned!

---

# STEP 4: CONFIGURE ENVIRONMENT VARIABLES

Environment variables are settings that tell your app how to run.

### 4.1 Create API Environment File

Navigate to API folder:
```bash
cd apps/api
```

Create .env file with configuration:

```bash
cat > .env << 'EOF'
DATABASE_URL=mysql://root:YourSecureDBPassword123@db:3306/sss
NODE_ENV=production
PORT=4000
JWT_ACCESS_SECRET=your-super-secret-access-key-12345-change-this-now
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your-super-secret-refresh-key-67890-change-this-now
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=https://sssfurniture.co.in
SUPERADMIN_NAME=Super Admin
SUPERADMIN_EMAIL=admin@sssfurniture.co.in
SUPERADMIN_PASSWORD=SecureAdminPassword123!
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

### 4.2 Secure the File

```bash
chmod 600 .env
```

### 4.3 Go Back to Project Root

```bash
cd ../..
```

✅ Environment variables configured!

---

# STEP 5: SETUP DOCKER COMPOSE FILE

Docker Compose file tells Docker how to run your services.

### 5.1 Check Your Docker Compose File

Your project already has `docker-compose.prod.yml`. Verify it exists:

```bash
cat docker-compose.prod.yml
```

It should contain configuration for:
- `db` (MySQL database)
- `api` (Node.js API server)
- `web` (Next.js frontend)
- `nginx` (Reverse proxy)

### 5.2 Ensure File Permissions

```bash
chmod 644 docker-compose.prod.yml
```

✅ Docker Compose file is ready!

---

# STEP 6: CREATE NGINX CONFIGURATION

Nginx acts as a reverse proxy. It:
- Receives requests from internet
- Routes them to correct container
- Handles SSL/HTTPS
- Balances traffic

### 6.1 Create Nginx Configuration File

Copy and paste the ENTIRE block:

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

    # Redirect HTTP to HTTPS
    server {
        listen 80;
        server_name sssfurniture.co.in api.sssfurniture.co.in admin.sssfurniture.co.in;
        return 301 https://$server_name$request_uri;
    }

    # Main Website (HTTPS)
    server {
        listen 443 ssl http2;
        server_name sssfurniture.co.in;

        ssl_certificate /etc/letsencrypt/live/sssfurniture.co.in/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/sssfurniture.co.in/privkey.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;

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

    # API Server (HTTPS)
    server {
        listen 443 ssl http2;
        server_name api.sssfurniture.co.in;

        ssl_certificate /etc/letsencrypt/live/sssfurniture.co.in/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/sssfurniture.co.in/privkey.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;

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
EOF
```

✅ Nginx configuration created!

---

# STEP 7: BUILD AND START SERVICES

### 7.1 Build Docker Images

Docker will download dependencies and compile your code. This takes 5-10 minutes.

```bash
docker-compose -f docker-compose.prod.yml build
```

Wait for build to complete. You'll see progress messages.

### 7.2 Create Data Directories

```bash
mkdir -p data/whatsapp-session
chmod 777 data/whatsapp-session
```

### 7.3 Start All Services in Background

```bash
docker-compose -f docker-compose.prod.yml up -d
```

The `-d` means "detached" (run in background).

### 7.4 Check Services Are Running

```bash
docker-compose -f docker-compose.prod.yml ps
```

You should see:
```
NAME      STATUS
db        Up
api       Up
web       Up
nginx     Up
```

All services should show `Up`.

### 7.5 View Startup Logs

```bash
docker-compose -f docker-compose.prod.yml logs -f
```

Watch the logs scroll. Look for any error messages. Press `CTRL + C` to exit.

✅ All Docker services are running!

---

# STEP 8: SETUP SSL CERTIFICATES

SSL certificates make your site secure (HTTPS).

### 8.1 Install Certbot (Certificate Tool)

```bash
apt install -y certbot python3-certbot-nginx
```

### 8.2 Generate SSL Certificates

**IMPORTANT: Replace `your-email@example.com` with your actual email:**

```bash
certbot certonly --standalone \
  -d sssfurniture.co.in \
  -d api.sssfurniture.co.in \
  -d admin.sssfurniture.co.in \
  -n --agree-tos --email your-email@example.com
```

Wait for success message:
```
Congratulations! Your certificate has been issued.
```

### 8.3 Setup Automatic Renewal (Every 90 Days)

```bash
systemctl enable certbot.timer
systemctl start certbot.timer
```

### 8.4 Restart Nginx Container

```bash
docker-compose -f docker-compose.prod.yml restart nginx
```

✅ SSL certificates are configured!

---

# STEP 9: VERIFY EVERYTHING WORKS

### 9.1 Check All Containers Running

```bash
docker-compose -f docker-compose.prod.yml ps
```

All should show `Up` status.

### 9.2 Check Container Logs for Errors

```bash
docker-compose -f docker-compose.prod.yml logs
```

Look for any red error text. Common issues:
- Database connection errors
- Port already in use
- Environment variable missing

### 9.3 Test Database Connection

```bash
docker-compose -f docker-compose.prod.yml exec db mysql -u root -p -e "SELECT 1;"
```

When asked for password, use the password from `docker-compose.prod.yml` or your .env file.

Should return `1`.

### 9.4 Test Website in Browser

Open your web browser and visit:

**Main Website:**
```
https://sssfurniture.co.in
```

**API Server:**
```
https://api.sssfurniture.co.in
```

**Admin Dashboard:**
```
https://admin.sssfurniture.co.in
```

All should load without errors. Look for:
- Green lock icon (HTTPS secure)
- No "connection refused" errors
- Website content loads

### 9.5 Check SSL Certificate

In browser address bar, click the lock icon. Should show:
- Certificate is valid
- Domain matches
- Issued by "Let's Encrypt"

✅ Everything is working!

---

# STEP 10: DAILY DOCKER COMMANDS

Use these commands to manage your application daily.

### Check Services Status

```bash
docker-compose -f docker-compose.prod.yml ps
```

Shows if all containers are `Up`.

### View Live Logs (All Services)

```bash
docker-compose -f docker-compose.prod.yml logs -f
```

Watch real-time logs from all services. Press `CTRL + C` to exit.

### View Specific Service Logs

View just API logs:
```bash
docker-compose -f docker-compose.prod.yml logs -f api
```

View just Web logs:
```bash
docker-compose -f docker-compose.prod.yml logs -f web
```

View just Database logs:
```bash
docker-compose -f docker-compose.prod.yml logs -f db
```

### View Last 50 Lines of Logs

```bash
docker-compose -f docker-compose.prod.yml logs --tail=50
```

### Restart All Services

If something is broken:

```bash
docker-compose -f docker-compose.prod.yml restart
```

### Restart Specific Service

```bash
docker-compose -f docker-compose.prod.yml restart api
```

### Stop All Services (Shutdown)

```bash
docker-compose -f docker-compose.prod.yml stop
```

Services stop but data persists.

### Start All Services Again

```bash
docker-compose -f docker-compose.prod.yml start
```

### View Resource Usage (CPU, Memory)

```bash
docker stats
```

Shows resource usage for each container. Press `CTRL + C` to exit.

### Access Container Shell (For Debugging)

Access API container:
```bash
docker-compose -f docker-compose.prod.yml exec api bash
```

Access Database container:
```bash
docker-compose -f docker-compose.prod.yml exec db bash
```

Type `exit` to leave container.

### Cleanup Unused Docker Images

```bash
docker image prune -a -f
```

Frees up disk space.

---

# STEP 11: HOW TO UPDATE CODE WITH DOCKER

When you push new code to GitHub, follow these steps to deploy:

### 11.1 SSH Into VPS

```bash
ssh root@185.230.63.171
```

### 11.2 Go to Project Directory

```bash
cd /home/sssfurniture
```

### 11.3 Pull Latest Code from GitHub

```bash
git pull origin main
```

This downloads your latest changes from GitHub.

### 11.4 Rebuild Docker Images (Code Has Changed)

```bash
docker-compose -f docker-compose.prod.yml build --no-cache
```

The `--no-cache` ensures fresh build. Wait for build to complete.

### 11.5 Stop Old Containers

```bash
docker-compose -f docker-compose.prod.yml down
```

This stops all containers. Database data is preserved.

### 11.6 Start New Containers

```bash
docker-compose -f docker-compose.prod.yml up -d
```

This starts containers with new code.

### 11.7 Verify Deployment

```bash
docker-compose -f docker-compose.prod.yml ps
```

All should show `Up`.

Check logs:
```bash
docker-compose -f docker-compose.prod.yml logs -f
```

✅ Code updated and deployed!

---

# STEP 12: COMPLETE GIT COMMANDS GUIDE

Git tracks changes to your code and lets you upload to GitHub.

## What is Git?

**Git** = A history book for your code. Tracks what changed and why.

---

## SETUP GIT (Do Once on Your Computer)

On your local computer, open Terminal/PowerShell:

```bash
git config --global user.name "Your Name"
git config --global user.email "your-email@example.com"
```

Verify:
```bash
git config --global user.name
git config --global user.email
```

---

## DAILY GIT WORKFLOW

### Step 1: Make Changes to Code
Edit files in your code editor.

### Step 2: Check What Changed
```bash
git status
```

Shows all modified files.

### Step 3: Stage Your Changes (Tell Git to Track)
```bash
git add .
```

The `.` means "add everything".

### Step 4: Commit (Save to History)
```bash
git commit -m "Description of what you changed"
```

Example:
```bash
git commit -m "Add email verification feature"
```

### Step 5: Push to GitHub
```bash
git push origin main
```

Uploads your changes to GitHub.

✅ Your code is now on GitHub!

---

## ESSENTIAL GIT COMMANDS

### Check Status
```bash
git status
```

Shows which files changed.

### View Commit History
```bash
git log --oneline -5
```

Shows last 5 commits.

### See Detailed Changes
```bash
git diff
```

Shows exact lines that changed.

### Add All Changes
```bash
git add .
```

### Add Specific File
```bash
git add filename.js
```

### Commit Changes
```bash
git commit -m "Your message"
```

### Push to GitHub
```bash
git push origin main
```

### Pull Latest Code
```bash
git pull origin main
```

Gets latest changes from GitHub.

### Undo Changes (Not Staged)
```bash
git checkout filename.js
```

Reverts file to last saved version.

### Undo All Changes
```bash
git checkout .
```

### Unstage Changes
```bash
git reset filename.js
```

### Undo Last Commit (Keep Changes)
```bash
git reset --soft HEAD~1
```

### Undo Last Commit (Delete Changes)
```bash
git reset --hard HEAD~1
```

⚠️ WARNING: This deletes your changes!

---

## DEPLOYMENT WORKFLOW: LOCAL TO VPS

### On Your Local Computer:

```bash
# Make changes to code
# ...

# Check what changed
git status

# Stage all changes
git add .

# Commit with message
git commit -m "Added authentication feature"

# Push to GitHub
git push origin main
```

### On VPS:

```bash
# SSH to VPS
ssh root@185.230.63.171

# Go to project
cd /home/sssfurniture

# Pull latest code
git pull origin main

# Rebuild Docker images
docker-compose -f docker-compose.prod.yml build --no-cache

# Stop old containers
docker-compose -f docker-compose.prod.yml down

# Start new containers
docker-compose -f docker-compose.prod.yml up -d

# Verify
docker-compose -f docker-compose.prod.yml ps
docker-compose -f docker-compose.prod.yml logs
```

✅ Deployment complete!

---

## COMMON GIT SCENARIOS

### Scenario 1: You Changed Files, Want to Deploy

```bash
git add .
git commit -m "Fixed authentication bug"
git push origin main
```

### Scenario 2: You Made Mistakes, Want to Undo

```bash
git checkout .
```

### Scenario 3: You Want to See Commit History

```bash
git log --oneline -10
```

### Scenario 4: You Want Latest Code from GitHub

```bash
git pull origin main
```

### Scenario 5: You Pushed Code But There's a Bug

**Fix and push again:**
```bash
# Fix the file
git add filename.js
git commit -m "Fix: corrected bug"
git push origin main
```

### Scenario 6: You Want to Revert to Previous Version

```bash
git log --oneline -5
git revert <commit-hash>
git push origin main
```

---

## GIT BRANCHES

### See All Branches
```bash
git branch -a
```

### Create New Branch
```bash
git checkout -b feature/my-feature
```

### Switch to Different Branch
```bash
git checkout main
```

### Merge Branch into Main
```bash
git checkout main
git merge feature/my-feature
git push origin main
```

---

## COMMIT MESSAGE BEST PRACTICES

### Good Messages ✅
```bash
git commit -m "Add email verification"
git commit -m "Fix database connection timeout"
git commit -m "Update user profile page"
git commit -m "Remove deprecated functions"
```

### Bad Messages ❌
```bash
git commit -m "fixed"
git commit -m "update"
git commit -m "asdf"
git commit -m "work"
```

---

## TROUBLESHOOTING GIT

### Problem: "Permission denied" when pushing

**Solution: Use Personal Access Token**

1. Go to GitHub → Settings → Developer Settings → Personal Access Tokens
2. Generate new token
3. Copy the token
4. When Git asks for password, paste the token

### Problem: "Changes not staged for commit"

**Solution:**
```bash
git add .
git commit -m "Your message"
```

### Problem: "Merge conflict"

1. Open the conflicting file
2. Look for `<<<<` and `>>>>` markers
3. Edit and keep the code you want
4. Remove the conflict markers
5. Commit:
```bash
git add .
git commit -m "Resolve merge conflict"
git push origin main
```

### Problem: Accidentally Deleted a File

**Solution:**
```bash
git checkout filename.js
```

### Problem: Forgot to Add a File to Commit

```bash
git add filename.js
git commit --amend
```

---

## QUICK GIT REFERENCE

```bash
# Setup (once)
git config --global user.name "Name"
git config --global user.email "email@example.com"

# Daily
git status              # See changes
git add .              # Stage all
git commit -m "msg"    # Commit
git push origin main   # Push to GitHub

# Get latest
git pull origin main   # Pull from GitHub

# View history
git log --oneline -10  # See commits
git diff              # See changes

# Undo
git checkout .        # Undo all changes
git reset --hard HEAD~1  # Delete last commit

# Branches
git checkout -b feature  # Create branch
git checkout main        # Switch to main
git merge feature        # Merge branch
```

---

# STEP 13: DOCKER COMMANDS REFERENCE

## Container Management

### List Running Containers
```bash
docker-compose -f docker-compose.prod.yml ps
```

### List All Containers (Running & Stopped)
```bash
docker ps -a
```

### Start Services
```bash
docker-compose -f docker-compose.prod.yml start
```

### Stop Services
```bash
docker-compose -f docker-compose.prod.yml stop
```

### Restart Services
```bash
docker-compose -f docker-compose.prod.yml restart
```

### Restart Specific Container
```bash
docker-compose -f docker-compose.prod.yml restart api
```

---

## Image Management

### Build Images
```bash
docker-compose -f docker-compose.prod.yml build
```

### Build Without Cache (Fresh Build)
```bash
docker-compose -f docker-compose.prod.yml build --no-cache
```

### List Images
```bash
docker image ls
```

### Remove Image
```bash
docker image rm image-name
```

### Remove Unused Images
```bash
docker image prune -a -f
```

---

## Logging & Debugging

### View All Logs
```bash
docker-compose -f docker-compose.prod.yml logs
```

### View Logs Live (Real-time)
```bash
docker-compose -f docker-compose.prod.yml logs -f
```

### View Specific Service Logs
```bash
docker-compose -f docker-compose.prod.yml logs -f api
```

### View Last 100 Lines
```bash
docker-compose -f docker-compose.prod.yml logs --tail=100
```

### Execute Command in Container
```bash
docker-compose -f docker-compose.prod.yml exec api bash
```

---

## Docker Compose Commands

### Start Services (Background)
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Start Services (Foreground - See Logs)
```bash
docker-compose -f docker-compose.prod.yml up
```

### Stop All Services
```bash
docker-compose -f docker-compose.prod.yml stop
```

### Stop and Remove All Containers
```bash
docker-compose -f docker-compose.prod.yml down
```

### Stop and Remove Everything (Including Volumes)
```bash
docker-compose -f docker-compose.prod.yml down -v
```

---

## Volume Management

### List Volumes
```bash
docker volume ls
```

### Inspect Volume
```bash
docker volume inspect volume-name
```

### Remove Volume
```bash
docker volume rm volume-name
```

---

## System Management

### View Resource Usage
```bash
docker stats
```

### View Docker Info
```bash
docker info
```

### Cleanup Everything Unused
```bash
docker system prune -a
```

### Remove All Containers
```bash
docker container prune -f
```

### Remove All Volumes
```bash
docker volume prune -f
```

---

# STEP 14: TROUBLESHOOTING

### Problem: Containers Not Starting

**Step 1: Check Status**
```bash
docker-compose -f docker-compose.prod.yml ps
```

**Step 2: View Logs**
```bash
docker-compose -f docker-compose.prod.yml logs
```

Look for red error text.

**Step 3: Restart Everything**
```bash
docker-compose -f docker-compose.prod.yml restart
```

### Problem: API Container Crashes

**View API Logs:**
```bash
docker-compose -f docker-compose.prod.yml logs api
```

Look for error message. Common issues:
- Database not running
- Environment variables missing
- Port already in use

**Fix:**
```bash
docker-compose -f docker-compose.prod.yml restart api
```

### Problem: Database Connection Error

**Check Database is Running:**
```bash
docker-compose -f docker-compose.prod.yml ps db
```

Should show `Up`.

**View Database Logs:**
```bash
docker-compose -f docker-compose.prod.yml logs db
```

**Restart Database:**
```bash
docker-compose -f docker-compose.prod.yml restart db
```

### Problem: Cannot Access Website

**Step 1: Check Nginx is Running**
```bash
docker-compose -f docker-compose.prod.yml ps nginx
```

**Step 2: View Nginx Logs**
```bash
docker-compose -f docker-compose.prod.yml logs nginx
```

**Step 3: Restart Nginx**
```bash
docker-compose -f docker-compose.prod.yml restart nginx
```

### Problem: SSL Certificate Not Working

**Check Certificates Exist:**
```bash
ls -la /etc/letsencrypt/live/sssfurniture.co.in/
```

**Renew Certificates:**
```bash
certbot renew --force-renewal
```

**Restart Nginx:**
```bash
docker-compose -f docker-compose.prod.yml restart nginx
```

### Problem: Out of Disk Space

**Check Disk Usage:**
```bash
df -h
```

**Clean Up Docker:**
```bash
docker system prune -a
docker image prune -a -f
docker volume prune -f
```

### Problem: High Memory Usage

**View Container Resource Usage:**
```bash
docker stats
```

**Restart Services:**
```bash
docker-compose -f docker-compose.prod.yml restart
```

### Problem: Database Data Lost

**Check Volume Exists:**
```bash
docker volume ls | grep db_data
```

**Inspect Volume:**
```bash
docker volume inspect db_data
```

**Backup Data:**
```bash
docker run --rm -v db_data:/data -v $(pwd):/backup alpine tar czf /backup/db_backup.tar.gz /data
```

### Problem: Services Crash on Startup

**Rebuild Without Cache:**
```bash
docker-compose -f docker-compose.prod.yml down -v
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

### Problem: Port Already in Use

**View What's Using Port:**
```bash
lsof -i :80
lsof -i :443
lsof -i :3000
lsof -i :4000
```

**Kill Process Using Port:**
```bash
kill -9 <PID>
```

Replace `<PID>` with the process ID number.

### Problem: Can't Connect to VPS

**Verify VPS is Running:**
Contact your hosting provider. Or try again:
```bash
ssh root@185.230.63.171
```

### Problem: Docker Daemon Not Running

**Start Docker:**
```bash
systemctl start docker
systemctl enable docker
```

**Verify:**
```bash
systemctl status docker
```

---

# QUICK REFERENCE

## Most Used Commands

```bash
# Start services
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Restart services
docker-compose -f docker-compose.prod.yml restart

# Stop services
docker-compose -f docker-compose.prod.yml stop

# Update and deploy
git pull origin main
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d
```

---

## Important Ports

- **Web Frontend**: 3000 (Internal) → HTTPS via Nginx
- **API Server**: 4000 (Internal) → HTTPS via Nginx
- **Database**: 3306 (Internal) → Only accessible from containers
- **Nginx**: 80 (HTTP) → 443 (HTTPS) (Public)

---

## Your Domains

- **Main Website**: `https://sssfurniture.co.in` → Port 3000
- **API Server**: `https://api.sssfurniture.co.in` → Port 4000
- **Admin Panel**: `https://admin.sssfurniture.co.in` → Port 3000

---

## Important Directories on VPS

- **Project Root**: `/home/sssfurniture`
- **Docker Compose File**: `/home/sssfurniture/docker-compose.prod.yml`
- **Nginx Config**: `/home/sssfurniture/nginx.conf`
- **API Config**: `/home/sssfurniture/apps/api/.env`
- **SSL Certs**: `/etc/letsencrypt/live/sssfurniture.co.in/`
- **Database Volume**: Docker managed (persistent)

---

## Environment Variables

Located in: `/home/sssfurniture/apps/api/.env`

Key variables:
- `DATABASE_URL` - Database connection string
- `NODE_ENV` - Set to `production`
- `JWT_ACCESS_SECRET` - Secret key (change this!)
- `JWT_REFRESH_SECRET` - Secret key (change this!)
- `CORS_ORIGIN` - Your domain

---

## Final Deployment Checklist

✅ Docker installed
✅ Docker Compose installed
✅ Git installed
✅ Project cloned from GitHub
✅ Environment variables configured
✅ Docker Compose file ready
✅ Nginx configuration created
✅ Docker images built
✅ All containers running (`Up` status)
✅ Database accessible
✅ API responding
✅ Website loading
✅ HTTPS/SSL working (green lock)
✅ SSL auto-renewal enabled
✅ Git remote configured

---

# YOU'RE DONE! 🎉

Your application is now:
- ✅ Running in Docker containers
- ✅ Auto-restarting if containers crash
- ✅ Auto-starting after VPS reboot
- ✅ Accessible via HTTPS/SSL
- ✅ Database data persistent
- ✅ Proxied through Nginx
- ✅ Production ready

**Your site is live at:**
- 🌐 `https://sssfurniture.co.in`
- 🔗 `https://api.sssfurniture.co.in`
- 🔐 `https://admin.sssfurniture.co.in`

---

## Next Steps:

1. **Test your website** at `https://sssfurniture.co.in`
2. **Monitor logs** regularly: `docker-compose -f docker-compose.prod.yml logs -f`
3. **Keep this file** for reference and future deployments
4. **Follow STEP 11** each time you want to deploy new code
5. **Use Git** to manage your code versions

---

## Daily Monitoring Checklist:

✅ Check containers running: `docker-compose -f docker-compose.prod.yml ps`
✅ Check logs for errors: `docker-compose -f docker-compose.prod.yml logs`
✅ Verify website loads: Visit your domain in browser
✅ Test API: Visit API domain
✅ Monitor disk space: `df -h`
✅ Monitor resource usage: `docker stats`

---

## When Something Breaks:

1. **Check logs**: `docker-compose -f docker-compose.prod.yml logs`
2. **Restart service**: `docker-compose -f docker-compose.prod.yml restart api`
3. **Refer to STEP 14**: Troubleshooting section
4. **Check DNS**: Verify your domain points to this VPS IP
5. **Check SSL**: Visit domain, look for green lock

---

## Deployment Process Every Time You Update Code:

```bash
# On your computer
git add .
git commit -m "Description"
git push origin main

# On VPS
ssh root@185.230.63.171
cd /home/sssfurniture
git pull origin main
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d
docker-compose -f docker-compose.prod.yml ps
```

**That's it! Your new code is live!**

---

**Save this file. Print it. Reference it often. Good luck! 🚀**
