# COMPLETE PM2 DEPLOYMENT GUIDE - ALL STEPS IN ONE FILE

**For Complete Beginners - Zero Technical Knowledge Required**

Every command is ready to copy-paste. Just follow step by step.

---

## TABLE OF CONTENTS

### Choose ONE Deployment Method:

**OPTION A: PM2 Deployment (Recommended for Beginners)**
1. Connect to VPS
2. Install All Software
3. Clone Your Project  
4. Install Dependencies
5. Setup Database
6. Configure PM2
7. Start Services with PM2
8. Setup Nginx
9. Add SSL Certificates
10. Verify Everything Works
11. Daily PM2 Commands
12. How to Update Code with PM2
13. Complete Git Commands Guide
14. PM2 Troubleshooting

**OPTION B: Docker Deployment (Skip to Step 1B below)**
- Docker Setup
- Docker Compose Configuration
- Services Management
- Deployment Workflow
- Docker Troubleshooting

---

# STEP 1: CONNECT TO YOUR VPS

Your VPS is: **185.230.63.171**

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

# STEP 2: INSTALL ALL SOFTWARE

All commands below work on any Linux server.

### 2.1 Update System (REQUIRED - Do This First!)

Copy and paste this entire command:

```bash
apt update && apt upgrade -y
```

Wait for it to finish (takes 1-2 minutes).

### 2.2 Install Node.js (Required for your app to run)

Copy and paste this:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && apt install -y nodejs
```

Wait for it to finish.

**Verify Node is installed:**
```bash
node --version
npm --version
```

You should see version numbers. If you see errors, re-run the command above.

### 2.3 Install PM2 (The tool that keeps your apps running)

Copy and paste:

```bash
npm install -g pm2
```

**Verify PM2 is installed:**
```bash
pm2 --version
```

### 2.4 Install Git (For version control and pulling code)

Copy and paste:

```bash
apt install -y git
```

**Verify:**
```bash
git --version
```

### 2.5 Install MySQL (Your database)

Copy and paste:

```bash
apt install -y mysql-server
```

**Start MySQL and make it run automatically:**
```bash
systemctl start mysql
systemctl enable mysql
```

**Verify MySQL is running:**
```bash
systemctl status mysql
```

Press `q` to exit.

✅ All software is installed!

---

# STEP 3: CLONE YOUR PROJECT FROM GITHUB

### 3.1 Navigate to the Projects Directory

```bash
cd /home
```

### 3.2 Clone Your Repository

**Replace these with YOUR actual GitHub username and repository name:**
- `YOUR-USERNAME` = Your GitHub username
- `YOUR-REPO` = Your repository name

For example: `git clone https://github.com/kamalesh/portfolio.git sssfurniture`

Copy and paste (with YOUR details):
```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git sssfurniture
```

Wait for it to finish downloading.

### 3.3 Go Into Your Project Folder

```bash
cd sssfurniture
```

### 3.4 Verify Files Are There

```bash
ls -la
```

You should see: `apps`, `package.json`, `.git`, etc.

✅ Your project is cloned!

---

# STEP 4: INSTALL ALL DEPENDENCIES

Your project has 3 parts: root, API, and Web. Each needs dependencies installed.

### 4.1 Install Root Dependencies

```bash
npm install
```

**This will take 2-3 minutes. Wait for it to finish.**

### 4.2 Install API Dependencies

```bash
cd apps/api
npm install
cd ../..
```

**This will take 2-3 minutes. Wait for it to finish.**

### 4.3 Install Web Dependencies

```bash
cd apps/web
npm install
cd ../..
```

**This will take 3-5 minutes. Wait for it to finish.**

✅ All dependencies installed!

---

# STEP 5: SETUP DATABASE

Your app stores data in MySQL. We need to create the database and configure it.

### 5.1 Create the Database

Copy and paste:

```bash
mysql -u root -e "CREATE DATABASE sss CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 5.2 Create Configuration File for API

Navigate to API folder:
```bash
cd apps/api
```

**Create the .env configuration file:**

Copy and paste the ENTIRE block below:

```bash
cat > .env << 'EOF'
DATABASE_URL=mysql://root:@localhost:3306/sss
NODE_ENV=production
PORT=4000
JWT_ACCESS_SECRET=your-super-secret-key-12345-change-this
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your-super-secret-refresh-key-67890-change-this
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=https://sssfurniture.co.in
SUPERADMIN_NAME=Super Admin
SUPERADMIN_EMAIL=admin@sssfurniture.co.in
SUPERADMIN_PASSWORD=SecurePassword123!
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

**⚠️ IMPORTANT:** Later change:
- `JWT_ACCESS_SECRET` - Make it a long random string
- `JWT_REFRESH_SECRET` - Make it a different long random string
- `SUPERADMIN_PASSWORD` - Use a strong password

### 5.3 Run Database Setup (Creates Tables)

Still in `apps/api` folder, run:

```bash
npm run prisma:migrate
```

This will ask a question. Type and press Enter:
```
sss_migration
```

### 5.4 Compile API Code (TypeScript to JavaScript)

Still in `apps/api` folder, run:

```bash
npm run build
```

Wait for it to finish. You should see a `dist` folder appear.

### 5.5 Go Back to Project Root

```bash
cd ../..
```

✅ Database is configured!

---

# STEP 6: CONFIGURE PM2

PM2 is the tool that keeps your apps running 24/7. We need to tell it how to run your apps.

### 6.1 Create PM2 Configuration File

Copy and paste the ENTIRE block below:

```bash
cat > ecosystem.config.js << 'EOF'
module.exports = {
  apps: [
    {
      name: "api",
      script: "./dist/main.js",
      cwd: "./apps/api",
      instances: 2,
      exec_mode: "cluster",
      env: {
        NODE_ENV: "production",
        PORT: 4000
      },
      error_file: "./logs/api-error.log",
      out_file: "./logs/api-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      watch: false,
      ignore_watch: ["node_modules", "dist"],
      max_memory_restart: "500M"
    },
    {
      name: "web",
      script: "npm",
      args: "start",
      cwd: "./apps/web",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
        NEXT_PUBLIC_API_URL: "https://api.sssfurniture.co.in/api"
      },
      error_file: "./logs/web-error.log",
      out_file: "./logs/web-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      merge_logs: true,
      autorestart: true,
      max_restarts: 10,
      min_uptime: "10s",
      watch: false,
      ignore_watch: ["node_modules", ".next"],
      max_memory_restart: "500M"
    }
  ]
};
EOF
```

### 6.2 Create Log Directories

```bash
mkdir -p ./apps/api/logs
mkdir -p ./apps/web/logs
```

✅ PM2 is configured!

---

# STEP 7: START SERVICES WITH PM2

### 7.1 Start All Services

```bash
pm2 start ecosystem.config.js
```

You should see:
```
┌─────────────────────────┐
│ id │ name │ mode │ status │
├─────────────────────────┤
│ 0  │ api  │ cluster │ online │
│ 1  │ web  │ fork │ online │
└─────────────────────────┘
```

### 7.2 Check Services Are Running

```bash
pm2 status
```

Both `api` and `web` should show `online` in green.

### 7.3 View Live Logs (See What's Happening)

```bash
pm2 logs
```

You'll see logs from both services. Press `CTRL + C` to exit logs.

### 7.4 IMPORTANT: Save PM2 Configuration (For Auto-Start After Reboot)

```bash
pm2 save
```

This saves the current services.

### 7.5 Setup Auto-Start on VPS Reboot

```bash
pm2 startup
```

This will show you a long command. **Copy and paste the suggested command exactly as shown.**

After running that command, run:
```bash
pm2 save
```

✅ Services are running and will auto-start!

---

# STEP 8: SETUP NGINX

Nginx acts as a reverse proxy. It receives requests from the internet and forwards them to your app.

### 8.1 Install Nginx

```bash
apt install -y nginx
```

### 8.2 Create Nginx Configuration

Copy and paste the ENTIRE block:

```bash
cat > /etc/nginx/sites-available/sssfurniture << 'EOF'
# Redirect HTTP to HTTPS
server {
    listen 80;
    listen [::]:80;
    server_name sssfurniture.co.in api.sssfurniture.co.in admin.sssfurniture.co.in;
    return 301 https://$server_name$request_uri;
}

# Main Website (sssfurniture.co.in)
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name sssfurniture.co.in;

    ssl_certificate /etc/letsencrypt/live/sssfurniture.co.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sssfurniture.co.in/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://localhost:3000;
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

# API Server (api.sssfurniture.co.in)
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name api.sssfurniture.co.in;

    ssl_certificate /etc/letsencrypt/live/sssfurniture.co.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sssfurniture.co.in/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://localhost:4000;
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

# Admin Dashboard (admin.sssfurniture.co.in)
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name admin.sssfurniture.co.in;

    ssl_certificate /etc/letsencrypt/live/sssfurniture.co.in/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/sssfurniture.co.in/privkey.pem;

    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    location / {
        proxy_pass http://localhost:3000;
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
EOF
```

### 8.3 Enable This Configuration

```bash
ln -s /etc/nginx/sites-available/sssfurniture /etc/nginx/sites-enabled/
```

### 8.4 Test Nginx Configuration (Before Starting)

```bash
nginx -t
```

You should see:
```
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
```

If you see errors, go back and check the configuration.

### 8.5 Start Nginx

```bash
systemctl start nginx
systemctl enable nginx
```

### 8.6 Verify Nginx is Running

```bash
systemctl status nginx
```

You should see `active (running)`. Press `q` to exit.

✅ Nginx is running!

---

# STEP 9: ADD SSL CERTIFICATES (HTTPS)

SSL certificates make your site secure (HTTPS instead of HTTP).

### 9.1 Install Certbot (Tool for SSL certificates)

```bash
apt install -y certbot python3-certbot-nginx
```

### 9.2 Generate SSL Certificates

**IMPORTANT: Replace `your-email@example.com` with your actual email address.**

Copy and paste:

```bash
certbot certonly --standalone \
  -d sssfurniture.co.in \
  -d api.sssfurniture.co.in \
  -d admin.sssfurniture.co.in \
  -n --agree-tos --email your-email@example.com
```

Wait for it to finish. You should see:
```
Congratulations! Your certificate has been issued.
```

### 9.3 Setup Automatic Certificate Renewal (Every 90 days)

```bash
systemctl enable certbot.timer
systemctl start certbot.timer
```

### 9.4 Reload Nginx with SSL

```bash
systemctl reload nginx
```

✅ SSL is configured!

---

# STEP 10: VERIFY EVERYTHING WORKS

### 10.1 Check All Services Are Running

```bash
pm2 status
```

Should show:
- `api` = online ✅
- `web` = online ✅

### 10.2 Check Nginx is Running

```bash
systemctl status nginx
```

Should show: `active (running)` ✅

### 10.3 Check Database

```bash
mysql -u root -e "SELECT 1;"
```

Should show: `1` ✅

### 10.4 Test Website from Another Computer

Open your browser and visit:
- `https://sssfurniture.co.in` - Should show your website
- `https://api.sssfurniture.co.in` - Should show API info
- `https://admin.sssfurniture.co.in` - Should show admin panel

### 10.5 Check Logs for Any Errors

```bash
pm2 logs
```

Look for any red error messages. If you see errors, write them down and refer to troubleshooting section.

Press `CTRL + C` to exit logs.

✅ Everything is working!

---

# STEP 11: DAILY COMMANDS YOU NEED

### Check Everything is Running

```bash
pm2 status
```

### View Live Logs (What's Happening Right Now)

```bash
pm2 logs
```

Press `CTRL + C` to exit.

### View Just API Logs

```bash
pm2 logs api
```

### View Just Web Logs

```bash
pm2 logs web
```

### Restart All Services (If Something is Broken)

```bash
pm2 restart all
```

### Restart Just API

```bash
pm2 restart api
```

### Stop All Services (To Shut Down)

```bash
pm2 stop all
```

### Start All Services Again

```bash
pm2 start ecosystem.config.js
```

### Monitor Resource Usage (CPU, Memory)

```bash
pm2 monit
```

Press `CTRL + C` to exit.

### See Database Status

```bash
mysql -u root -e "SELECT 1;"
```

### Restart Database

```bash
systemctl restart mysql
```

### Restart Nginx

```bash
systemctl restart nginx
```

---

# STEP 12: HOW TO UPDATE YOUR CODE

When you push new code to GitHub, follow these steps to deploy it:

### 12.1 SSH Into Your VPS

```bash
ssh root@185.230.63.171
```

### 12.2 Go to Your Project

```bash
cd /home/sssfurniture
```

### 12.3 Pull Latest Code from GitHub

```bash
git pull origin main
```

### 12.4 Install Any New Dependencies (If package.json changed)

```bash
npm install
cd apps/api && npm install && cd ../..
cd apps/web && npm install && cd ../..
```

### 12.5 Rebuild API (If Backend Code Changed)

```bash
cd apps/api
npm run build
cd ../..
```

### 12.6 Restart Services

```bash
pm2 restart all
```

### 12.7 Verify Everything Works

```bash
pm2 status
pm2 logs
```

### 12.8 If Something Broke, Revert

If new code broke something:

```bash
git log --oneline
git checkout <previous-commit-hash>
npm run build
cd ../..
pm2 restart all
```

✅ Code updated!

---

# STEP 13: COMPLETE GIT COMMANDS GUIDE

Git is a version control system. It tracks changes to your code and lets you upload them to GitHub.

## What is Git?

**Git = A tool to track changes in your code**

Think of it like a history book for your project. Every time you make changes, Git records what changed and why.

---

## GIT SETUP (Do Once)

### 13.1 Configure Git (First Time Only)

**On your LOCAL computer (not VPS), open Terminal/PowerShell:**

```bash
git config --global user.name "Your Name"
git config --global user.email "your-email@example.com"
```

### 13.2 Verify Configuration

```bash
git config --global user.name
git config --global user.email
```

---

## BASIC GIT WORKFLOW (What You Do Every Day)

### Step 1: Make Changes to Code
(Edit files in your editor)

### Step 2: Check What Changed
```bash
git status
```

This shows all files you modified. You'll see:
- Red files = Not staged
- Green files = Staged

### Step 3: Stage Your Changes (Tell Git What to Save)
```bash
git add .
```

The `.` means "add everything". You can also add specific files:
```bash
git add apps/api/src/app.ts
git add apps/web/pages/index.tsx
```

### Step 4: Check Staged Changes
```bash
git status
```

Should show green files now.

### Step 5: Commit (Save to Git History)
```bash
git commit -m "Description of what you changed"
```

Example:
```bash
git commit -m "Add email authentication feature"
```

### Step 6: Push to GitHub (Upload to Server)
```bash
git push origin main
```

**DONE!** Your code is now on GitHub and can be deployed.

---

## ESSENTIAL GIT COMMANDS

### Check Current Status
```bash
git status
```

Shows which files changed, which are staged.

### See Your Commit History
```bash
git log
```

Shows all commits with messages. Press `q` to exit.

### See Last 5 Commits
```bash
git log --oneline -5
```

Much cleaner view.

### See Changes in Files (Before Committing)
```bash
git diff
```

Shows exact lines that changed.

### See Changes in Staged Files
```bash
git diff --staged
```

### Add All Changes
```bash
git add .
```

Stages all modified files.

### Add Specific File
```bash
git add filename.js
```

Stages only that file.

### Undo Changes (Before Staging)
```bash
git checkout filename.js
```

Reverts the file to last committed version.

### Undo Staging
```bash
git reset filename.js
```

Removes file from staging but keeps your edits.

### Undo Last Commit (Before Pushing)
```bash
git reset --soft HEAD~1
```

Undo commit but keep changes staged.

### Undo Last Commit (Delete Changes)
```bash
git reset --hard HEAD~1
```

⚠️ WARNING: This deletes your changes! Use carefully.

### Push Code to GitHub
```bash
git push origin main
```

Uploads all committed changes to GitHub.

### Pull Latest Code from GitHub
```bash
git pull origin main
```

Downloads latest changes from GitHub.

### See Remote Repository
```bash
git remote -v
```

Shows which GitHub repo you're connected to.

### Switch Branches
```bash
git checkout develop
```

Switches to the `develop` branch.

### Create New Branch
```bash
git checkout -b feature/new-feature
```

Creates and switches to new branch.

### Merge Branch into Main
```bash
git checkout main
git pull origin main
git merge feature/new-feature
git push origin main
```

---

## DEPLOYMENT WORKFLOW WITH GIT

### When You Want to Deploy New Code:

#### On Your Local Computer:

**1. Make changes to your code**

**2. Check what changed:**
```bash
git status
```

**3. Stage all changes:**
```bash
git add .
```

**4. Commit with message:**
```bash
git commit -m "Fix bug in user authentication"
```

**5. Push to GitHub:**
```bash
git push origin main
```

#### On Your VPS:

**6. SSH into VPS:**
```bash
ssh root@185.230.63.171
```

**7. Go to project:**
```bash
cd /home/sssfurniture
```

**8. Pull latest code:**
```bash
git pull origin main
```

**9. Install dependencies (if changed):**
```bash
npm install
cd apps/api && npm install && cd ../..
cd apps/web && npm install && cd ../..
```

**10. Rebuild (if backend changed):**
```bash
cd apps/api
npm run build
cd ../..
```

**11. Restart services:**
```bash
pm2 restart all
```

**12. Verify:**
```bash
pm2 status
```

✅ **Deployment complete!**

---

## COMMON GIT SCENARIOS

### Scenario 1: You Changed Files and Want to Upload

```bash
# Check changes
git status

# Stage all
git add .

# Commit
git commit -m "Added new feature"

# Push
git push origin main
```

### Scenario 2: You Made Mistakes and Want to Undo

**Undo unstaged changes:**
```bash
git checkout filename.js
```

**Undo all unstaged changes:**
```bash
git checkout .
```

**Undo staged changes:**
```bash
git reset filename.js
```

**Undo last commit (keep changes):**
```bash
git reset --soft HEAD~1
```

**Undo last commit (delete changes):**
```bash
git reset --hard HEAD~1
```

### Scenario 3: You Want to See What Changed

```bash
# See what you modified
git diff

# See your commit history
git log --oneline -10

# See changes in specific file
git diff filename.js
```

### Scenario 4: You Want to Update Local Code from GitHub

```bash
git pull origin main
```

**This downloads latest changes from GitHub.**

### Scenario 5: You Want to Compare Your Code with GitHub

```bash
# See commits ahead/behind
git status

# See all differences
git diff origin/main
```

### Scenario 6: You Accidentally Deleted a File

```bash
# Restore the file
git checkout filename.js
```

### Scenario 7: You Pushed Code but It Has a Bug

**Option 1: Fix and push again**
```bash
# Fix the file
# Then:
git add filename.js
git commit -m "Fix: corrected bug in authentication"
git push origin main
```

**Option 2: Revert to previous version**
```bash
# See commit history
git log --oneline -5

# Revert to previous commit
git revert <commit-hash>
git push origin main
```

Example:
```bash
git log --oneline -5
# Output:
# a1b2c3d Fix authentication
# b2c3d4e Add user login
# c3d4e5f Initial commit

git revert a1b2c3d
git push origin main
```

---

## GIT BRANCHES EXPLAINED

### What is a Branch?

A branch is like a separate copy of your code. You can work on one branch without affecting the main code.

### Main Branch
```bash
git checkout main
```

This is your production code. Always keep it working.

### Create Feature Branch
```bash
git checkout -b feature/user-authentication
```

Work on new features in branches, then merge to main.

### See All Branches
```bash
git branch -a
```

### Delete Branch
```bash
git branch -D feature/old-feature
```

### Merge Branch to Main
```bash
git checkout main
git pull origin main
git merge feature/user-authentication
git push origin main
```

---

## GIT COMMIT MESSAGES (Best Practices)

### Good Commit Messages

```bash
# Good ✅
git commit -m "Add email verification feature"
git commit -m "Fix database connection timeout"
git commit -m "Update API response format"

# Bad ❌
git commit -m "fixed stuff"
git commit -m "update"
git commit -m "asdf"
```

### Message Format

```
<action> <what you did>
```

**Actions:**
- `Add` - New feature
- `Fix` - Bug fix
- `Update` - Update existing code
- `Remove` - Delete code
- `Refactor` - Reorganize code
- `Test` - Add tests

**Examples:**
```bash
git commit -m "Add payment gateway integration"
git commit -m "Fix memory leak in database pool"
git commit -m "Update npm dependencies"
git commit -m "Remove deprecated functions"
git commit -m "Refactor authentication module"
```

---

## GITHUB WORKFLOW SUMMARY

### Daily Workflow:

**Morning:** Pull latest code
```bash
git pull origin main
```

**Throughout Day:** Make changes, commit regularly
```bash
git add .
git commit -m "Description"
```

**Evening:** Push all changes
```bash
git push origin main
```

**On VPS:** Pull and deploy
```bash
cd /home/sssfurniture
git pull origin main
npm install
npm run build
pm2 restart all
```

---

## TROUBLESHOOTING GIT

### Problem: "Permission denied" when pushing

**Solution: Update GitHub credentials**

GitHub no longer accepts password. Use Personal Access Token:

1. Go to GitHub Settings → Developer Settings → Personal Access Tokens
2. Generate new token
3. When Git asks for password, paste the token instead

### Problem: "Changes not staged for commit"

**Solution:**
```bash
git add .
git commit -m "Your message"
```

### Problem: "Merge conflict"

**When you pull and there are conflicts:**

1. Open the file with conflict (marked with `<<<<` and `>>>>`)
2. Edit and keep the code you want
3. Remove the conflict markers
4. Stage and commit:
```bash
git add .
git commit -m "Resolve merge conflict"
git push origin main
```

### Problem: "Detached HEAD state"

**Solution:**
```bash
git checkout main
```

### Problem: Can't Push - "Rejected"

**Solution: Pull first**
```bash
git pull origin main
git push origin main
```

### Problem: Accidentally Committed Wrong File

**Solution:**
```bash
# See what's in last commit
git show HEAD

# Undo last commit
git reset --soft HEAD~1

# Remove the file from staging
git reset filename.js

# Recommit without that file
git commit -m "Fixed: removed wrong file"
```

---

## QUICK GIT REFERENCE

```bash
# Setup (once)
git config --global user.name "Your Name"
git config --global user.email "email@example.com"

# Clone (first time)
git clone https://github.com/username/repo.git

# Daily work
git status              # See changes
git add .              # Stage all
git commit -m "msg"    # Commit
git push origin main   # Push

# Update
git pull origin main   # Get latest

# View history
git log --oneline -10  # See commits
git diff              # See changes

# Undo
git checkout .        # Undo all changes
git reset --hard HEAD~1  # Delete last commit

# Branches
git checkout -b feature/name  # Create branch
git checkout main             # Switch to main
git merge feature/name        # Merge branch
```

---

## YOUR GITHUB CHECKLIST

✅ GitHub account created
✅ Repository created
✅ Git installed locally
✅ Git configured with your name/email
✅ Repository cloned to VPS
✅ Can push code to GitHub
✅ Can pull code from GitHub
✅ Deployment workflow tested

---

# STEP 14: TROUBLESHOOTING

### Problem: Services Show "Stopped"

**Solution:**

**Solution:**
```bash
pm2 restart all
```

### Problem: Website Not Loading

**Check if Nginx is running:**
```bash
systemctl status nginx
```

**If not running, start it:**
```bash
systemctl restart nginx
```

**Check Nginx config:**
```bash
nginx -t
```

### Problem: "Cannot connect to database"

**Check MySQL:**
```bash
systemctl status mysql
```

**If not running:**
```bash
systemctl restart mysql
```

**Test connection:**
```bash
mysql -u root -e "SELECT 1;"
```

### Problem: API Service Crashes

**View error logs:**
```bash
pm2 logs api
```

Look for the red error message. Common causes:
- Missing .env file
- Database not running
- Port already in use

**Restart:**
```bash
pm2 restart api
```

### Problem: Port Already in Use

**Find what's using port 4000:**
```bash
lsof -i :4000
```

**Kill the process:**
```bash
kill -9 <PID>
```

(Replace `<PID>` with the number shown)

### Problem: Out of Disk Space

**Check disk usage:**
```bash
df -h
```

**Clear old logs:**
```bash
pm2 flush
```

### Problem: High Memory Usage

**View memory stats:**
```bash
pm2 monit
```

**Restart services:**
```bash
pm2 restart all
```

### Problem: SSL Certificate Not Working

**Check certificate:**
```bash
certbot certificates
```

**Force renew:**
```bash
certbot renew --force-renewal
```

**Reload Nginx:**
```bash
systemctl reload nginx
```

### Problem: Can't SSH Into VPS

**Check if VPS is running** (contact your hosting provider)

**Try again:**
```bash
ssh root@185.230.63.171
```

### Problem: Can't Clone Repository

**Check Git is installed:**
```bash
git --version
```

**Check GitHub credentials** (you may need to use a personal access token instead of password)

**Try clone again:**
```bash
cd /home
rm -rf sssfurniture
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git sssfurniture
```

---

# QUICK REFERENCE

## Most Used Commands

```bash
# View status
pm2 status

# View logs
pm2 logs

# Restart
pm2 restart all

# Stop
pm2 stop all

# Update code
cd /home/sssfurniture
git pull origin main
npm install
cd apps/api && npm install && npm run build && cd ../..
pm2 restart all

# Check database
mysql -u root -e "SELECT 1;"

# Check Nginx
nginx -t
systemctl restart nginx
```

## Ports Used

- **Website**: Port 3000 (via Nginx)
- **API**: Port 4000 (via Nginx)
- **Database**: Port 3306
- **Nginx**: Port 80 & 443

## Your Domains

- `https://sssfurniture.co.in` → Website
- `https://api.sssfurniture.co.in` → API
- `https://admin.sssfurniture.co.in` → Admin

## Important Files

- PM2 Config: `/home/sssfurniture/ecosystem.config.js`
- Nginx Config: `/etc/nginx/sites-available/sssfurniture`
- API Config: `/home/sssfurniture/apps/api/.env`
- API Logs: `/home/sssfurniture/apps/api/logs/api-*.log`
- Web Logs: `/home/sssfurniture/apps/web/logs/web-*.log`
- Nginx Logs: `/var/log/nginx/error.log` & `/var/log/nginx/access.log`

---

# FINAL CHECKLIST

✅ Node.js installed
✅ PM2 installed
✅ Git installed
✅ MySQL installed
✅ Project cloned
✅ Dependencies installed
✅ Database created
✅ .env configured
✅ Database migrations run
✅ API built
✅ PM2 configured
✅ Services started
✅ PM2 auto-startup configured
✅ Nginx installed
✅ Nginx configured
✅ SSL certificates generated
✅ Website accessible at https://sssfurniture.co.in
✅ API accessible at https://api.sssfurniture.co.in
✅ All services running in `pm2 status`

---

# YOU'RE DONE! 🎉

Your app is now:
- ✅ Running 24/7 with PM2
- ✅ Auto-restarting if it crashes
- ✅ Auto-starting after VPS reboot
- ✅ Accessible via HTTPS
- ✅ Connected to database
- ✅ Proxied through Nginx

**Your site is live!**

**Next steps:**
1. Test your website at https://sssfurniture.co.in
2. Monitor logs: `pm2 logs`
3. Keep this file for reference
4. When updating code, follow "STEP 12: HOW TO UPDATE YOUR CODE"

---

## Need Help?

1. Check the logs: `pm2 logs`
2. Refer to STEP 13 Troubleshooting section
3. Check DNS is working: Verify your domains point to this VPS IP
4. Check SSL: Visit your domain, look for the green lock icon

**Save this file. You'll refer to it often!**

---

---

# 🐳 OPTION B: COMPLETE DOCKER DEPLOYMENT

**If you prefer Docker instead of PM2, follow this section instead.**

Docker containers run your entire app in an isolated environment.

---

# DOCKER STEP 1: INSTALL DOCKER

### 1.1 Update System

```bash
apt update && apt upgrade -y
```

### 1.2 Install Docker

```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh
```

**Verify:**
```bash
docker --version
```

### 1.3 Install Docker Compose

```bash
curl -L "https://github.com/docker/compose/releases/download/v2.20.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
chmod +x /usr/local/bin/docker-compose
```

**Verify:**
```bash
docker-compose --version
```

### 1.4 Start Docker Service

```bash
systemctl start docker
systemctl enable docker
```

✅ Docker is installed!

---

# DOCKER STEP 2: CLONE PROJECT (Same as PM2)

### 2.1 Navigate to Projects Directory

```bash
cd /home
```

### 2.2 Clone Your Repository

```bash
git clone https://github.com/YOUR-USERNAME/YOUR-REPO.git sssfurniture
cd sssfurniture
```

✅ Project cloned!

---

# DOCKER STEP 3: CONFIGURE ENVIRONMENT

### 3.1 Create API .env File

```bash
cd apps/api
```

```bash
cat > .env << 'EOF'
DATABASE_URL=mysql://root:yourSecurePassword123@db:3306/sss
NODE_ENV=production
PORT=4000
JWT_ACCESS_SECRET=your-super-secret-access-key-12345
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=your-super-secret-refresh-key-67890
JWT_REFRESH_EXPIRES_IN=7d
CORS_ORIGIN=https://sssfurniture.co.in
SUPERADMIN_NAME=Super Admin
SUPERADMIN_EMAIL=admin@sssfurniture.co.in
SUPERADMIN_PASSWORD=SecurePassword123!
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

### 3.2 Go Back to Root

```bash
cd ../..
```

✅ Environment configured!

---

# DOCKER STEP 4: SETUP DOCKER COMPOSE

Your project already has `docker-compose.prod.yml`. Just verify it exists:

```bash
ls -la docker-compose.prod.yml
```

---

# DOCKER STEP 5: CREATE NGINX CONFIGURATION

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

    server {
        listen 80;
        server_name sssfurniture.co.in api.sssfurniture.co.in admin.sssfurniture.co.in;
        return 301 https://$server_name$request_uri;
    }

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
            proxy_set_header Host $host;
            proxy_cache_bypass $http_upgrade;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }

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

        ssl_certificate /etc/letsencrypt/live/sssfurniture.co.in/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/sssfurniture.co.in/privkey.pem;

        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;
        ssl_prefer_server_ciphers on;

        location / {
            proxy_pass http://web:3000;
            proxy_http_version 1.1;
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

✅ Nginx configured!

---

# DOCKER STEP 6: BUILD AND START SERVICES

### 6.1 Build Docker Images

```bash
docker-compose -f docker-compose.prod.yml build
```

Wait for build to complete (5-10 minutes).

### 6.2 Start All Services

```bash
docker-compose -f docker-compose.prod.yml up -d
```

### 6.3 Check Status

```bash
docker-compose -f docker-compose.prod.yml ps
```

All should show `Up`.

### 6.4 Create Data Directory

```bash
mkdir -p data/whatsapp-session
chmod 777 data/whatsapp-session
```

✅ Services running!

---

# DOCKER STEP 7: SETUP SSL (Same as PM2)

### 7.1 Install Certbot

```bash
apt install -y certbot python3-certbot-nginx
```

### 7.2 Generate SSL Certificates

```bash
certbot certonly --standalone \
  -d sssfurniture.co.in \
  -d api.sssfurniture.co.in \
  -d admin.sssfurniture.co.in \
  -n --agree-tos --email your-email@example.com
```

### 7.3 Setup Auto-Renewal

```bash
systemctl enable certbot.timer
systemctl start certbot.timer
```

✅ SSL configured!

---

# DOCKER STEP 8: VERIFY EVERYTHING

### 8.1 Check Containers

```bash
docker-compose -f docker-compose.prod.yml ps
```

### 8.2 View Logs

```bash
docker-compose -f docker-compose.prod.yml logs -f
```

### 8.3 Test Website

Open browser and visit:
- `https://sssfurniture.co.in`
- `https://api.sssfurniture.co.in`
- `https://admin.sssfurniture.co.in`

✅ Everything working!

---

# DOCKER STEP 9: DAILY DOCKER COMMANDS

### Check Status

```bash
docker-compose -f docker-compose.prod.yml ps
```

### View Logs

```bash
docker-compose -f docker-compose.prod.yml logs -f
```

### View Specific Service

```bash
docker-compose -f docker-compose.prod.yml logs -f api
```

### Restart All Services

```bash
docker-compose -f docker-compose.prod.yml restart
```

### Restart One Service

```bash
docker-compose -f docker-compose.prod.yml restart api
```

### Stop All Services

```bash
docker-compose -f docker-compose.prod.yml stop
```

### Start All Services

```bash
docker-compose -f docker-compose.prod.yml start
```

### View Resource Usage

```bash
docker stats
```

---

# DOCKER STEP 10: UPDATE CODE WITH DOCKER

### 10.1 Pull Latest Code

```bash
cd /home/sssfurniture
git pull origin main
```

### 10.2 Rebuild Images

```bash
docker-compose -f docker-compose.prod.yml build --no-cache
```

### 10.3 Restart Services

```bash
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d
```

### 10.4 Verify

```bash
docker-compose -f docker-compose.prod.yml ps
```

✅ Code updated!

---

# DOCKER STEP 11: DOCKER COMMANDS QUICK REFERENCE

```bash
# Start
docker-compose -f docker-compose.prod.yml up -d

# Status
docker-compose -f docker-compose.prod.yml ps

# Logs
docker-compose -f docker-compose.prod.yml logs -f

# Restart
docker-compose -f docker-compose.prod.yml restart

# Stop
docker-compose -f docker-compose.prod.yml stop

# Remove
docker-compose -f docker-compose.prod.yml down

# Update and Deploy
git pull origin main
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d
```

---

# DOCKER STEP 12: DOCKER TROUBLESHOOTING

### Containers Not Starting

```bash
docker-compose -f docker-compose.prod.yml logs
```

### Database Error

```bash
docker-compose -f docker-compose.prod.yml restart db
```

### API Crashes

```bash
docker-compose -f docker-compose.prod.yml logs api
```

### Nginx Not Working

```bash
docker-compose -f docker-compose.prod.yml restart nginx
```

### Out of Space

```bash
docker system prune -a
docker image prune -a -f
```

### Everything Broken - Start Fresh

```bash
docker-compose -f docker-compose.prod.yml down -v
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

---

# DOCKER VS PM2 - COMPARISON

| Feature | PM2 | Docker |
|---------|-----|--------|
| Learning Curve | Easy | Medium |
| Isolation | No | Yes |
| Resource Usage | Lower | Higher |
| Deployment | Simple | Very Simple |
| Scaling | Medium | Very Easy |
| Production Ready | Yes | Yes |
| Best For | Direct Node Apps | Large Apps |

**Choose PM2 if:** You want simplicity and direct control
**Choose Docker if:** You want perfect isolation and easy scaling

---

**Both options are production-ready. Pick whichever you prefer!**
