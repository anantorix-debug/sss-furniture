# SSS Company - Setup & Deployment Guide

## Overview

This project supports **two deployment architectures**:

1. **Local Development (No Docker)** - Run API, Web, and Database locally for fast development
2. **Production (Docker)** - API and DB in containers, or WhatsApp-only in Docker

---

## Quick Start - Local Development

### Prerequisites
- **Node.js 18+** - [Download](https://nodejs.org/)
- **MySQL 8.0+** - Running locally on port 3306
- **npm 9+**

### Setup (Windows)
```powershell
# Run the setup script
.\setup-local.ps1

# Or manually:
# 1. Copy template: copy .env.local.example .env.local
# 2. Update .env.local with your DB credentials
# 3. npm install in both apps/api and apps/web
# 4. cd apps/api && npx prisma migrate deploy
```

### Setup (macOS/Linux)
```bash
# Run the setup script
chmod +x setup-local.sh
./setup-local.sh

# Or manually follow the same steps as Windows
```

### Start Development Servers
```bash
# Terminal 1: Start API server (port 4000)
cd apps/api
npm run start:dev

# Terminal 2: Start Web server (port 3000)
cd apps/web
npm run dev

# Or use root scripts:
npm run dev:api       # One terminal
npm run dev:web       # Another terminal
npm run dev:all       # Concurrent (requires concurrently)
```

### Access the Application
- **Web App**: http://localhost:3000
- **API**: http://localhost:4000/api
- **Prisma Studio**: `cd apps/api && npm run db:studio`

---

## Environment Configuration

### `.env.local` (Local Development)

```env
DATABASE_URL="mysql://root:root@localhost:3306/sss"
PORT=4000
NODE_ENV=development
CORS_ORIGIN="http://localhost:3001,http://localhost:3000"

WHATSAPP_ENABLED="true"
WWEBJS_AUTH_PATH=".wwebjs_auth"
```

See [.env.local.example](./.env.local.example) for all available options.

### Important Notes
- **Never commit `.env.local`** - Use `.env.local.example` as template
- **WhatsApp QR auth**: First run will show QR code in terminal, scan with WhatsApp
- **Database**: Ensure MySQL is running before starting API

---

## Database Management

### Initial Setup
```bash
npm run db:setup      # Migrate + seed database
```

### Create Migration
```bash
cd apps/api
npx prisma migrate dev --name your_migration_name
```

### Reset Database (Development Only)
```bash
npm run db:reset      # ⚠️ DESTRUCTIVE - drops all data
```

### View Database GUI
```bash
npm run db:studio     # Opens Prisma Studio browser interface
```

### Common Issues

**"Can't reach database server"**
- Ensure MySQL is running: `mysql --version`
- Check DATABASE_URL in .env.local
- Verify port 3306 is accessible

**"Table doesn't exist"**
- Run: `npm run db:setup`
- Or manually: `cd apps/api && npx prisma migrate deploy`

---

## Docker Deployment

### Option 1: Full Stack (API + DB + Web in Docker)

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop all services
docker-compose down
```

**Access:**
- Web: http://localhost:3001
- API: http://localhost:4000/api
- MySQL: localhost:3307 (volume: `db_data`)

---

### Option 2: WhatsApp-Only Docker (Production)

For production where API/DB run locally or on a VPS, but WhatsApp needs isolated chromium:

```bash
# Start only WhatsApp service (needs API running elsewhere)
docker-compose -f docker-compose.whatsapp-only.yml up -d

# View WhatsApp logs
docker-compose -f docker-compose.whatsapp-only.yml logs -f whatsapp

# Stop WhatsApp service
docker-compose -f docker-compose.whatsapp-only.yml down
```

**Configuration:**
- WhatsApp runs on port 4001
- Connect API to it via: `http://localhost:4001` (or `http://whatsapp:4000` if on Docker network)
- Database connection must be updated in Docker env vars

**When to use this:**
- API runs on local machine or VPS
- Only WhatsApp needs Docker for chromium/puppeteer
- Smaller memory footprint than full Docker stack

---

## WhatsApp Setup

### Session Authentication (Local Development)

First run will prompt for QR code:
```
📱 Scan this QR code with WhatsApp (one-time only):
```

1. Open WhatsApp on your phone
2. Go to **Settings → Linked devices**
3. Click **Link a device**
4. Scan the QR code from terminal

The session is saved in `.wwebjs_auth/` and persists across restarts.

### Rate Limiting

WhatsApp enforces anti-spam limits (configured in `.env.local`):

```env
WHATSAPP_MAX_PER_RECIPIENT_PER_DAY=5    # Max 5 messages per person per day
WHATSAPP_MAX_PER_HOUR=30                # Max 30 total messages per hour
WHATSAPP_MIN_DELAY_MS=4000              # Min 4s between messages
WHATSAPP_MAX_DELAY_MS=9000              # Max 9s between messages
```

### Troubleshooting

**"WhatsApp not connected"**
- Check terminal for QR code
- Ensure session directory `.wwebjs_auth/` is writable
- Check logs: `API: WhatsApp client ready ✓`

**"Cannot find Chrome"**
- Install chromium locally: `apt-get install chromium` (Linux)
- Or set `PUPPETEER_EXECUTABLE_PATH` in .env.local
- Docker handles this automatically

**Session expired**
- Delete `.wwebjs_auth/` folder
- Restart API server
- Scan QR code again

---

## Development Scripts

### Root-Level Commands
```bash
# Local development
npm run setup:local       # One-time setup
npm run dev:all           # Start API + Web concurrently
npm run build:all         # Build both apps

# Database
npm run db:setup          # Initial DB setup
npm run db:migrate        # Create new migration
npm run db:studio         # Open Prisma Studio

# Docker
npm run docker:full       # Full stack
npm run docker:whatsapp   # WhatsApp only
npm run docker:logs       # View logs
```

### API Commands
```bash
cd apps/api
npm run start:dev         # Dev server with hot reload
npm run build             # Production build
npm run start:prod        # Run built version
npm test                  # Run tests
npm run lint              # ESLint
```

### Web Commands
```bash
cd apps/web
npm run dev               # Dev server (port 3000)
npm run build             # Production build
npm start                 # Run built version
npm run lint              # Next.js linting
```

---

## Project Structure

```
sss/
├── apps/
│   ├── api/              # NestJS backend
│   │   ├── src/
│   │   │   ├── whatsapp/        # WhatsApp Web.js integration
│   │   │   ├── auth/            # Authentication
│   │   │   ├── carpenter/       # Domain modules
│   │   │   └── ...
│   │   ├── prisma/              # Database schema
│   │   ├── Dockerfile           # Full Docker image
│   │   ├── Dockerfile.whatsapp  # WhatsApp-only image
│   │   └── package.json
│   └── web/              # Next.js frontend
│       └── package.json
├── .wwebjs_auth/         # WhatsApp session (gitignored)
├── data/                 # Data directory (gitignored)
├── docker-compose.yml    # Full stack Docker
├── docker-compose.whatsapp-only.yml
├── setup-local.ps1       # Windows setup script
├── setup-local.sh        # macOS/Linux setup script
├── package.json          # Root workspace package.json
└── .env.local.example    # Environment template
```

---

## Deployment to VPS

### Prerequisites
- Ubuntu 22.04+ with Docker & Docker Compose
- MySQL running separately or in Docker
- Node.js 18+ (for non-Docker API)

### Steps

1. **Copy files to VPS**
   ```bash
   scp -r . user@vps:/app/sss
   ```

2. **On VPS - Local API Setup**
   ```bash
   cd /app/sss/apps/api
   npm install
   npm run build
   
   # Setup .env for production
   cp .env.example .env.production
   # Edit .env.production with real values
   
   # Run with PM2 or systemd
   npm run start:prod
   ```

3. **On VPS - WhatsApp Docker (Optional)**
   ```bash
   docker-compose -f docker-compose.whatsapp-only.yml up -d
   ```

4. **Verify**
   ```bash
   curl http://localhost:4000/api/health
   ```

---

## Troubleshooting

### "Port 4000 already in use"
```bash
# Find process using port
lsof -i :4000           # macOS/Linux
netstat -ano | findstr :4000  # Windows

# Kill process
kill -9 <PID>           # macOS/Linux
taskkill /PID <PID> /F  # Windows
```

### "EACCES: permission denied"
```bash
# Run with correct permissions
sudo chown -R $(whoami) node_modules
npm install
```

### "Module not found" errors
```bash
# Regenerate Prisma client
cd apps/api
npx prisma generate

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Database connection issues
- Verify MySQL is running: `mysql -u root -p` (enter password)
- Check DATABASE_URL format in .env.local
- Ensure database exists: `CREATE DATABASE sss;`

---

## Performance Tips

### Local Development
- Use `npm run start:dev` for hot reload
- Open separate terminals for API and Web servers
- Use Prisma Studio for quick data inspection

### Production
- Use Docker for consistency
- Set `NODE_ENV=production`
- Use reverse proxy (nginx) in front of API
- Monitor WhatsApp queue depth

---

## Next Steps

1. **Run setup**: `npm run setup:local`
2. **Start development**: `npm run dev:all`
3. **Check WhatsApp**: Look for QR code or "WhatsApp client ready" in logs
4. **Create first migration**: `npm run db:migrate`

For more help, see:
- [WhatsApp Implementation Guide](./WHATSAPP_INTEGRATION_GUIDE.md)
- [Docker Deployment Guide](./DOCKER_DEPLOYMENT_GUIDE.md)
- [NestJS Docs](https://docs.nestjs.com/)
- [Next.js Docs](https://nextjs.org/docs/)
