# Manual VPS Deployment - Copy & Paste Instructions

**VPS Details:**
- Host: 187.53.132.7
- User: root
- Password: Anantorix@2026

---

## Step 1: Connect to VPS via SSH

Open your terminal/cmd and run:
```bash
ssh root@187.53.132.7
```

Enter password: `Anantorix@2026`

---

## Step 2: Run Deployment Commands

Once connected to VPS, copy-paste these commands ONE by ONE:

### Command 1: Update System
```bash
apt-get update -y && apt-get upgrade -y
```

### Command 2: Install Docker
```bash
curl -fsSL https://get.docker.com -o get-docker.sh && sh get-docker.sh
```

### Command 3: Install Docker Compose
```bash
curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose && chmod +x /usr/local/bin/docker-compose
```

### Command 4: Install Required Tools
```bash
apt-get install -y git certbot python3-certbot-nginx curl
```

### Command 5: Clone Repository
```bash
git clone https://github.com/anantorix-debug/sss-furniture.git /root/sss-furniture && cd /root/sss-furniture
```

### Command 6: Create API Environment File
```bash
mkdir -p /root/sss-furniture/apps/api
cat > /root/sss-furniture/apps/api/.env << 'EOF'
DATABASE_URL=mysql://root:root@db:3306/sss
NODE_ENV=production
JWT_ACCESS_SECRET=prod-secret-key-2026-sss-furniture
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
```

### Command 7: Create Web Environment File
```bash
mkdir -p /root/sss-furniture/apps/web
cat > /root/sss-furniture/apps/web/.env.local << 'EOF'
NEXT_PUBLIC_API_URL=https://api.sssfurniture.co.in/api
EOF
```

### Command 8: Create Docker Compose Production File
```bash
cd /root/sss-furniture
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
```

### Command 9: Create Nginx Configuration
```bash
cat > /root/sss-furniture/nginx.conf << 'EOF'
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
EOF
```

### Command 10: Generate SSL Certificates
```bash
mkdir -p /etc/letsencrypt/live/api.sssfurniture.co.in
mkdir -p /etc/letsencrypt/live/admin.sssfurniture.co.in
certbot certonly --standalone -d api.sssfurniture.co.in -d admin.sssfurniture.co.in --non-interactive --agree-tos --email admin@sss.com --preferred-challenges http
```

### Command 11: Build and Start Docker Containers
```bash
cd /root/sss-furniture
docker-compose -f docker-compose.prod.yml down || true
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
```

### Command 12: Initialize Database
```bash
sleep 15
cd /root/sss-furniture
docker-compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy
docker-compose -f docker-compose.prod.yml exec -T api npx prisma db seed
```

### Command 13: Verify Deployment
```bash
cd /root/sss-furniture
docker-compose -f docker-compose.prod.yml ps
```

You should see all 4 containers as "Up":
- db
- api
- web
- nginx

---

## Step 3: Test Your Deployment

### Test API
```bash
curl -X GET https://api.sssfurniture.co.in/api/auth/me
```

Expected response: `{"message":"Unauthorized"}` (401 is normal)

### Test Admin Panel
Open in browser: `https://admin.sssfurniture.co.in`

Login with:
- Email: `admin@sss.com`
- Password: `admin123`

---

## ✅ Deployment Complete!

Your application is now live:
- **API:** https://api.sssfurniture.co.in
- **Admin Panel:** https://admin.sssfurniture.co.in

---

## Troubleshooting

### If Docker build fails
```bash
docker system prune -a -f
cd /root/sss-furniture
docker-compose -f docker-compose.prod.yml build --no-cache
```

### View logs
```bash
docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f
```

### Check container status
```bash
docker-compose -f /root/sss-furniture/docker-compose.prod.yml ps
```

### Restart containers
```bash
docker-compose -f /root/sss-furniture/docker-compose.prod.yml restart
```

---

For more help, see:
- DEPLOYMENT.md - Complete deployment guide
- REDEPLOY_QUICK_GUIDE.md - For future updates

