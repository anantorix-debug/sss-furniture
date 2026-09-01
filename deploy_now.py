#!/usr/bin/env python3
"""
Direct VPS Deployment Script
Uses SSH to deploy SSS Furniture to production
"""

import subprocess
import sys
import os

def main():
    vps_host = "187.53.132.7"
    vps_user = "root"
    vps_password = "Anantorix@2026"

    print("=" * 60)
    print("SSS Furniture - VPS Deployment")
    print("=" * 60)
    print()
    print("Connecting to VPS: 187.53.132.7")
    print()

    # Create SSH command using bash
    ssh_command = f"""
ssh -o StrictHostKeyChecking=accept-new \
    -o UserKnownHostsFile=/dev/null \
    {vps_user}@{vps_host} \
    'bash <(curl -s https://raw.githubusercontent.com/anantorix-debug/sss-furniture/main/QUICK_DEPLOY.sh)'
"""

    print("Starting deployment... (this will take 5-10 minutes)")
    print()

    try:
        result = subprocess.run(ssh_command, shell=True)
        if result.returncode == 0:
            print()
            print("=" * 60)
            print("✅ DEPLOYMENT COMPLETED SUCCESSFULLY")
            print("=" * 60)
            print()
            print("🌐 Access Your Application:")
            print("  API:   https://api.sssfurniture.co.in")
            print("  Admin: https://admin.sssfurniture.co.in")
            print()
            print("👤 Login Credentials:")
            print("  Email:    admin@sss.com")
            print("  Password: admin123")
            print()
            return 0
        else:
            print()
            print("⚠️  Deployment encountered an issue.")
            print("Please SSH manually and check logs:")
            print(f"  ssh root@{vps_host}")
            print("  docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f")
            return 1
    except KeyboardInterrupt:
        print("\n❌ Deployment cancelled")
        return 1
    except Exception as e:
        print(f"\n❌ Error: {e}")
        return 1

if __name__ == "__main__":
    sys.exit(main())
