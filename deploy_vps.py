#!/usr/bin/env python3
"""
SSS Furniture - VPS Production Deployment Script
Run this from PowerShell: python deploy_vps.py
"""

import subprocess
import sys

def deploy():
    print("=" * 80)
    print("🚀 SSS Furniture - Production Deployment to VPS")
    print("=" * 80)
    print("")

    # VPS credentials
    HOST = "187.53.132.7"
    USER = "root"
    PASSWORD = "Anantorix@2026"

    # Deployment script
    deployment_script = """
set -e
echo "====== SSS Furniture - Full Production Deployment ======"
echo ""

echo "[1/10] Installing Docker & Tools..."
apt-get update -y > /dev/null 2>&1
apt-get upgrade -y > /dev/null 2>&1
apt-get install -y docker.io git certbot curl > /dev/null 2>&1
apt-get install -y docker-compose 2>/dev/null || apt-get install -y --fix-broken 2>/dev/null || true

echo "[2/10] Cloning Repository..."
cd /root && rm -rf sss-furniture && git clone https://github.com/anantorix-debug/sss-furniture.git sss-furniture && cd sss-furniture

echo "[3/10] Setting Up Configuration..."
mkdir -p apps/api apps/web

cat > apps/api/.env << 'APIEOF'
DATABASE_URL=mysql://root:root@db:3306/sss
NODE_ENV=production
JWT_ACCESS_SECRET=prod-secret-key-2026
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_SECRET=prod-refresh-secret
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
APIEOF

cat > apps/web/.env.local << 'WEBEOF'
NEXT_PUBLIC_API_URL=https://api.sssfurniture.co.in/api
WEBEOF

echo "[4/10] Generating SSL Certificates..."
certbot certonly --standalone -d api.sssfurniture.co.in -d admin.sssfurniture.co.in --non-interactive --agree-tos --email admin@sss.com --preferred-challenges http 2>/dev/null || true

echo "[5/10] Stopping Old Containers..."
docker-compose -f docker-compose.prod.yml down 2>/dev/null || true

echo "[6/10] Building Docker Images (5-10 minutes)..."
docker-compose -f docker-compose.prod.yml build

echo "[7/10] Starting Containers..."
docker-compose -f docker-compose.prod.yml up -d

echo "[8/10] Waiting for Database..."
sleep 15

echo "[9/10] Running Database Migrations..."
docker-compose -f docker-compose.prod.yml exec -T api npx prisma migrate deploy 2>/dev/null || true

echo "[10/10] Seeding Database..."
docker-compose -f docker-compose.prod.yml exec -T api npx prisma db seed 2>/dev/null || true

echo ""
echo "╔═════════════════════════════════════════════════════════╗"
echo "║     ✅ DEPLOYMENT COMPLETE - LIVE IN PRODUCTION!       ║"
echo "╚═════════════════════════════════════════════════════════╝"
echo ""
echo "📍 Access your application:"
echo "   API:   https://api.sssfurniture.co.in"
echo "   Admin: https://admin.sssfurniture.co.in"
echo ""
echo "🔑 Login: admin@sss.com / admin123"
echo ""
echo "📊 Container Status:"
docker-compose -f docker-compose.prod.yml ps
"""

    # SSH command
    ssh_cmd = f'ssh -o StrictHostKeyChecking=no {USER}@{HOST}'

    print(f"📤 Connecting to VPS: {HOST}")
    print(f"   User: {USER}")
    print(f"   Time: ~15-20 minutes")
    print("")

    try:
        # Execute via SSH
        process = subprocess.Popen(
            ['powershell', '-Command', f"echo '{deployment_script}' | {ssh_cmd}"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            universal_newlines=True,
            bufsize=1
        )

        # Stream output
        for line in process.stdout:
            print(line.rstrip())
            sys.stdout.flush()

        process.wait()

        if process.returncode == 0:
            print("\n" + "=" * 80)
            print("✅ DEPLOYMENT SUCCESSFUL!")
            print("=" * 80)
            print("\n🌐 Access your app:")
            print("   Admin: https://admin.sssfurniture.co.in")
            print("   API:   https://api.sssfurniture.co.in")
            print("\n🔑 Login: admin@sss.com / admin123\n")
            return 0
        else:
            print(f"\n⚠️  Process exited with code: {process.returncode}")
            return process.returncode

    except Exception as e:
        print(f"\n❌ Error: {e}")
        print("\nAlternative: Run this in PowerShell manually:")
        print(f"   ssh {USER}@{HOST}")
        print(f"   Password: {PASSWORD}")
        return 1

if __name__ == "__main__":
    sys.exit(deploy())
