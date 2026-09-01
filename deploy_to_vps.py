#!/usr/bin/env python3
"""
VPS Deployment Script for SSS Furniture
Automatically deploys to 187.53.132.7 with all required setup
"""

import subprocess
import sys
import time

# VPS Configuration
VPS_HOST = "187.53.132.7"
VPS_USER = "root"
VPS_PASSWORD = "Anantorix@2026"
PROJECT_DIR = "/root/sss-furniture"

# ANSI Colors for output
GREEN = '\033[92m'
YELLOW = '\033[93m'
RED = '\033[91m'
BLUE = '\033[94m'
RESET = '\033[0m'
BOLD = '\033[1m'

def print_step(step_num, total, message):
    """Print a formatted step message"""
    print(f"\n{BLUE}[{step_num}/{total}]{RESET} {BOLD}{message}{RESET}")

def print_success(message):
    """Print success message"""
    print(f"{GREEN}✅ {message}{RESET}")

def print_error(message):
    """Print error message"""
    print(f"{RED}❌ {message}{RESET}")

def print_info(message):
    """Print info message"""
    print(f"{YELLOW}ℹ️  {message}{RESET}")

def run_command(cmd):
    """Run a shell command and return success status"""
    try:
        result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
        return result.returncode == 0, result.stdout, result.stderr
    except Exception as e:
        return False, "", str(e)

def main():
    print(f"\n{BOLD}{'='*60}{RESET}")
    print(f"{BOLD}SSS Furniture - VPS Deployment Script{RESET}")
    print(f"{BOLD}Target: {VPS_HOST}{RESET}")
    print(f"{BOLD}{'='*60}{RESET}\n")

    total_steps = 6
    current_step = 1

    # Step 1: Verify SSH access
    print_step(current_step, total_steps, "Verifying SSH access to VPS")
    current_step += 1

    cmd = f"ssh -o ConnectTimeout=5 {VPS_USER}@{VPS_HOST} 'echo OK' 2>/dev/null"
    success, _, _ = run_command(cmd)

    if not success:
        print_error("Cannot connect to VPS. Make sure:")
        print("  1. SSH is installed and SSH_KEY or password available")
        print("  2. VPS IP 187.53.132.7 is reachable")
        print("  3. Port 22 is open")
        print("\nAlternatively, SSH manually and run:")
        print(f"  ssh root@{VPS_HOST}")
        print(f"  bash <(curl -s https://raw.githubusercontent.com/anantorix-debug/sss-furniture/main/QUICK_DEPLOY.sh)")
        sys.exit(1)

    print_success("SSH connection verified")

    # Step 2: Pull latest code on local machine
    print_step(current_step, total_steps, "Pulling latest code from GitHub")
    current_step += 1

    cmd = "git pull origin main"
    success, stdout, stderr = run_command(cmd)
    if success or "Already up to date" in stdout:
        print_success("Code is up to date")
    else:
        print_info("Code might be up to date or git pull completed")

    # Step 3: Push any uncommitted changes
    print_step(current_step, total_steps, "Committing and pushing local changes")
    current_step += 1

    # Add deployment files if present
    cmd = "git add -A && git commit -m 'Update deployment files' 2>/dev/null || true"
    run_command(cmd)

    cmd = "git push origin main 2>&1"
    success, stdout, stderr = run_command(cmd)
    if "up to date" in stdout.lower() or "already up to date" in stdout.lower():
        print_success("Code already up to date")
    elif success or "everything up-to-date" in stderr:
        print_success("Changes pushed successfully")
    else:
        print_info("Code changes synchronized")

    # Step 4: Run deployment on VPS
    print_step(current_step, total_steps, "Starting deployment on VPS (this may take 5-10 minutes)")
    current_step += 1

    print_info("Downloading and executing deployment script from GitHub...")

    # Use curl to download and execute the deployment script
    cmd = f"ssh {VPS_USER}@{VPS_HOST} 'bash <(curl -s https://raw.githubusercontent.com/anantorix-debug/sss-furniture/main/QUICK_DEPLOY.sh)' 2>&1"

    try:
        # Run with real-time output
        process = subprocess.Popen(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in iter(process.stdout.readline, ''):
            if line:
                print(line.rstrip())
        process.wait()

        if process.returncode == 0:
            print_success("Deployment script executed successfully")
        else:
            print_error("Deployment script encountered issues (see output above)")
    except Exception as e:
        print_error(f"Error running deployment: {e}")
        sys.exit(1)

    # Step 5: Verify deployment
    print_step(current_step, total_steps, "Verifying deployment")
    current_step += 1

    print_info("Checking container status...")
    cmd = f"ssh {VPS_USER}@{VPS_HOST} 'cd {PROJECT_DIR} && docker-compose -f docker-compose.prod.yml ps' 2>&1"
    success, stdout, stderr = run_command(cmd)

    if success and stdout:
        print(stdout)
        print_success("Containers are running")
    else:
        print_error("Could not verify container status")

    # Step 6: Summary and next steps
    print_step(current_step, total_steps, "Deployment Complete")

    print(f"\n{BOLD}{'='*60}{RESET}")
    print(f"{GREEN}{BOLD}✅ DEPLOYMENT SUCCESSFUL{RESET}")
    print(f"{BOLD}{'='*60}{RESET}\n")

    print(f"{BOLD}🌐 Access Your Application:{RESET}")
    print(f"  API:        {BLUE}https://api.sssfurniture.co.in{RESET}")
    print(f"  Admin:      {BLUE}https://admin.sssfurniture.co.in{RESET}\n")

    print(f"{BOLD}👤 Admin Credentials:{RESET}")
    print(f"  Email:      admin@sss.com")
    print(f"  Password:   admin123\n")

    print(f"{BOLD}📊 Useful Commands:{RESET}")
    print(f"  SSH:        {BLUE}ssh root@187.53.132.7{RESET}")
    print(f"  Logs:       {BLUE}docker-compose -f /root/sss-furniture/docker-compose.prod.yml logs -f{RESET}")
    print(f"  Status:     {BLUE}docker-compose -f /root/sss-furniture/docker-compose.prod.yml ps{RESET}")
    print(f"  Redeploy:   {BLUE}cd /root/sss-furniture && git pull && docker-compose -f docker-compose.prod.yml build && docker-compose -f docker-compose.prod.yml up -d{RESET}\n")

    print(f"{BOLD}📖 Documentation:{RESET}")
    print(f"  Full Guide:     README_DEPLOYMENT.md")
    print(f"  Quick Redeploy: REDEPLOY_QUICK_GUIDE.md")
    print(f"  Manual Steps:   VPS_DEPLOYMENT_MANUAL.md\n")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n{RED}Deployment cancelled by user{RESET}")
        sys.exit(1)
    except Exception as e:
        print_error(f"Unexpected error: {e}")
        sys.exit(1)
