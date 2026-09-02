# Quick Reference - All Changes & Commands

## 🆕 New Files Created

### Configuration
| File | Purpose |
|------|---------|
| `.env.local.example` | Template for local development environment |
| `package.json` | Root workspace with npm scripts |

### Scripts
| File | Purpose | Usage |
|------|---------|-------|
| `setup-local.ps1` | Windows setup script | `.\setup-local.ps1` |
| `setup-local.sh` | macOS/Linux setup script | `chmod +x setup-local.sh && ./setup-local.sh` |
| `deploy.ps1` | Multi-mode deployment | `.\deploy.ps1 -mode local\|docker\|prod` |

### Docker
| File | Purpose |
|------|---------|
| `docker-compose.whatsapp-only.yml` | WhatsApp service only |
| `apps/api/Dockerfile.whatsapp` | Minimal WhatsApp Docker image |

### Documentation
| File | Purpose |
|------|---------|
| `SETUP_GUIDE.md` | Complete setup and operations guide |
| `WHATSAPP_SESSION_REFACTOR.md` | WhatsApp implementation enhancements |
| `RESTRUCTURING_SUMMARY.md` | Overview of all changes |
| `QUICK_REFERENCE.md` | This file |
| `A2_RESTRUCTURING_GUIDE.md` | A2 backend reorganization plan |

---

## 🚀 Getting Started (Copy-Paste)

### Windows
```powershell
# 1. Initial setup
.\setup-local.ps1

# 2. Edit .env.local with your DB credentials
notepad .env.local

# 3. Terminal 1: Start API
cd apps\api
npm run start:dev

# 4. Terminal 2: Start Web
cd apps\web
npm run dev

# 5. Open browser
Start-Process http://localhost:3000
```

### macOS/Linux
```bash
# 1. Initial setup
chmod +x setup-local.sh
./setup-local.sh

# 2. Edit .env.local with your DB credentials
nano .env.local

# 3. Terminal 1: Start API
cd apps/api
npm run start:dev

# 4. Terminal 2: Start Web
cd apps/web
npm run dev

# 5. Open browser
open http://localhost:3000
```

---

## 📋 All npm Scripts

### Setup & Development
```bash
npm run setup:local         # ⭐ One-time setup
npm run dev:all             # Start API + Web together
npm run dev:api             # Start API only
npm run dev:web             # Start Web only
npm run build:all           # Build both for production
npm run build:api           # Build API
npm run build:web           # Build Web
```

### Database
```bash
npm run db:setup            # Migrate + seed
npm run db:migrate          # Create new migration
npm run db:seed             # Seed data
npm run db:studio           # GUI database viewer
npm run db:reset            # ⚠️ DELETE all data
```

### Docker (Optional)
```bash
npm run docker:full         # Start all services
npm run docker:down         # Stop all services
npm run docker:whatsapp     # Start WhatsApp only
npm run docker:whatsapp:down # Stop WhatsApp
npm run docker:logs         # View logs
npm run docker:logs:api     # View API logs
npm run docker:logs:db      # View DB logs
```

### Testing & Linting
```bash
npm run lint                # Lint all
npm run lint:api            # Lint API
npm run lint:web            # Lint Web
npm run test                # Test all
npm run test:api            # Test API
npm run test:api:watch      # Test API watch mode
npm run test:api:cov        # Test coverage
npm run test:e2e            # End-to-end tests
```

### Production
```bash
npm run start:api           # Run API production build
npm run start:web           # Run Web production build
```

---

## 🔧 Environment Setup

### Step 1: Copy Template
```bash
copy .env.local.example .env.local          # Windows
cp .env.local.example .env.local            # macOS/Linux
```

### Step 2: Edit Database Connection
```env
DATABASE_URL="mysql://root:root@localhost:3306/sss"
```

### Step 3: Update Other Secrets (Production)
```env
JWT_ACCESS_SECRET="change-this-in-production"
JWT_REFRESH_SECRET="change-this-in-production"
SUPERADMIN_PASSWORD="change-this-in-production"
```

### Step 4: Optional - WhatsApp Settings
```env
WHATSAPP_ENABLED="true"
WHATSAPP_MAX_PER_RECIPIENT_PER_DAY=5
WHATSAPP_MAX_PER_HOUR=30
```

---

## 🐳 Docker Quick Commands

### Full Stack (API + DB + Web)
```bash
# Start
npm run docker:full

# View logs
npm run docker:logs

# Stop
npm run docker:down

# Access
# - Web: http://localhost:3001
# - API: http://localhost:4000/api
# - Docs: http://localhost:4000/api/docs
```

### WhatsApp Only (for production)
```bash
# Start
npm run docker:whatsapp

# View logs
npm run docker:logs:whatsapp

# Stop
npm run docker:whatsapp:down

# Access
# - WhatsApp: http://localhost:4001
# (requires API running separately)
```

### Rebuild Images
```bash
docker-compose build --no-cache
docker-compose -f docker-compose.whatsapp-only.yml build --no-cache
```

---

## 📞 WhatsApp Setup

### First Time Authentication
```
When API starts:
1. Watch terminal for QR code
2. Open WhatsApp on phone
3. Settings → Linked devices → Link a device
4. Scan QR code
5. Session saved automatically
```

### Test Message
```bash
curl -X POST http://localhost:4000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{
    "phone":"9876543210",
    "message":"Hello WhatsApp!"
  }'
```

### Check Status
```bash
curl http://localhost:4000/api/whatsapp/status
```

### Reset Session
```bash
# Stop API
# Delete .wwebjs_auth/ folder
# Restart API
# Scan QR code again
```

---

## 🗄️ Database Commands

### Create Migration
```bash
cd apps/api
npx prisma migrate dev --name your_migration_name
```

### Deploy Migrations
```bash
npm run db:setup
# or
npx prisma migrate deploy
```

### View Database GUI
```bash
npm run db:studio
# Opens: http://localhost:5555
```

### Seed Sample Data
```bash
npm run db:seed
```

### Reset Database (Development Only)
```bash
npm run db:reset    # ⚠️ DELETES ALL DATA
```

---

## 🚢 Deployment

### Local Development
```bash
npm run setup:local
npm run dev:all
```

### Docker Deployment
```bash
npm run docker:full
```

### Production VPS
```bash
.\deploy.ps1 -mode prod -host user@vps.example.com
```

---

## 🐛 Troubleshooting

### MySQL Connection Failed
```bash
# Check if MySQL is running
mysql --version
mysql -u root -p

# Verify DATABASE_URL in .env.local
# Format: mysql://user:password@localhost:3306/database
```

### Port Already in Use
```bash
# Windows
netstat -ano | findstr :4000
taskkill /PID <PID> /F

# macOS/Linux
lsof -i :4000
kill -9 <PID>
```

### WhatsApp QR Code Not Showing
```bash
# Check terminal output (should show ASCII QR)
# Look for: "📱 Scan this QR code with WhatsApp"

# If not showing:
# 1. Verify WHATSAPP_ENABLED=true in .env.local
# 2. Check API logs for "WhatsApp"
# 3. Delete .wwebjs_auth/ and restart
```

### Docker Issues
```bash
# Check running containers
docker ps

# View container logs
docker logs <container_name>

# Remove stopped containers
docker container prune

# Rebuild images
docker-compose build --no-cache
```

### npm Permission Issues
```bash
# Fix node_modules permissions
chmod -R 755 node_modules

# Reinstall
rm -rf node_modules package-lock.json
npm install
```

---

## 📊 Project Structure

```
sss/
├── .wwebjs_auth/                    # WhatsApp sessions (gitignored)
├── data/
│   └── whatsapp-session/            # Session data (gitignored)
├── apps/
│   ├── api/                         # NestJS Backend
│   │   ├── src/
│   │   ├── dist/                    # Built files
│   │   ├── Dockerfile               # Full image
│   │   ├── Dockerfile.whatsapp      # Minimal image
│   │   └── package.json
│   └── web/                         # Next.js Frontend
│       ├── src/
│       └── package.json
├── .env.local                       # Local config (create from template)
├── .env.local.example               # Template
├── package.json                     # Root workspace
├── docker-compose.yml               # Full stack
├── docker-compose.whatsapp-only.yml # WhatsApp only
├── setup-local.ps1                  # Windows setup
├── setup-local.sh                   # Unix setup
└── deploy.ps1                       # Deployment helper
```

---

## 📚 Documentation Map

| Need | Read This |
|------|-----------|
| Complete setup guide | `SETUP_GUIDE.md` |
| WhatsApp features & troubleshooting | `WHATSAPP_INTEGRATION_GUIDE.md` |
| Enhance WhatsApp with A2 patterns | `WHATSAPP_SESSION_REFACTOR.md` |
| Overview of all changes | `RESTRUCTURING_SUMMARY.md` |
| A2 backend restructuring plan | `A2_RESTRUCTURING_GUIDE.md` |
| This quick reference | `QUICK_REFERENCE.md` |
| Docker deployment details | `DOCKER_DEPLOYMENT_GUIDE.md` |

---

## 🎯 Common Workflows

### Start Local Development
```bash
npm run setup:local      # First time only
npm run dev:api          # Terminal 1
npm run dev:web          # Terminal 2
```

### Deploy to Docker Locally
```bash
npm run docker:full
```

### Deploy WhatsApp to Docker Only
```bash
npm run docker:whatsapp
npm run dev:api          # API still local
```

### Create New Database Migration
```bash
cd apps/api
npx prisma migrate dev --name your_change
npm run db:studio        # Review data
```

### Test WhatsApp API
```bash
curl -X POST http://localhost:4000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{"phone":"9876543210","message":"Test"}'
```

### Deploy to Production VPS
```bash
.\deploy.ps1 -mode prod -host user@vps.example.com
```

### View All Logs
```bash
npm run docker:logs              # All Docker services
npm run docker:logs:api          # API logs only
npm run docker:logs:whatsapp     # WhatsApp logs only
```

---

## ✨ What You Get

✅ **No Docker for Local Development**
- Faster startup
- Better debugging
- Direct access to all services

✅ **Optional Docker for Production**
- Full stack in containers
- Or just WhatsApp in Docker
- Or all services on VPS

✅ **WhatsApp Features**
- Session-based authentication
- Queue management
- Rate limiting
- Document support
- Group messaging

✅ **Deployment Options**
- Local development
- Docker full stack
- Docker WhatsApp-only
- Production VPS

✅ **A2 Restructuring Blueprint**
- Clear patterns
- No breaking changes
- Phased approach
- Code examples included

---

## 🔐 Security Reminders

### Never Commit
```
.env.local              # Local secrets
.wwebjs_auth/           # WhatsApp sessions
node_modules/           # Dependencies
dist/                   # Built files
*.log                   # Log files
```

### Environment Variables
```bash
# Use .env.local for development
# Use .env for production (not in git)
# Use secure secret management (AWS Secrets, Vault, etc) for deployment
```

### Database
```bash
# Change superadmin password in production
# Rotate JWT secrets regularly
# Use strong MySQL passwords
# Enable SSL for remote connections
```

---

## 📞 Support Resources

- **NestJS Docs**: https://docs.nestjs.com/
- **Next.js Docs**: https://nextjs.org/docs/
- **Prisma Docs**: https://www.prisma.io/docs/
- **WhatsApp Web.js**: https://docs.wwebjs.dev/
- **Docker Docs**: https://docs.docker.com/

---

## 🎓 Learning Path

1. **Day 1**: Run `npm run setup:local` and get both servers running
2. **Day 2**: Test WhatsApp messaging, explore database with Prisma Studio
3. **Day 3**: Read `SETUP_GUIDE.md` for full understanding
4. **Day 4**: Try Docker: `npm run docker:full`
5. **Day 5**: Review `WHATSAPP_SESSION_REFACTOR.md` for enhancements
6. **Week 2**: Plan A2 backend changes with `A2_RESTRUCTURING_GUIDE.md`

---

**You're all set!** 🚀

Start with: `npm run setup:local`
