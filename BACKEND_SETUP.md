# Backend-Only Setup Guide

## New Project Structure

```
sss/
├── backend/                 ← All backend code here
│   ├── src/
│   │   ├── common/         ← Shared infrastructure
│   │   ├── config/         ← Configuration
│   │   ├── modules/        ← Feature modules (A2 structure)
│   │   │   ├── auth/
│   │   │   ├── users/
│   │   │   ├── whatsapp/   ← WhatsApp integration
│   │   │   ├── orders/     ← Consolidated (customer, party, purchase)
│   │   │   ├── inventory/  ← Consolidated (products, raw-materials)
│   │   │   ├── carpenter/
│   │   │   ├── suppliers/
│   │   │   ├── payments/
│   │   │   ├── reports/
│   │   │   ├── dashboard/
│   │   │   ├── audit/
│   │   │   ├── pdf/
│   │   │   ├── search/
│   │   │   ├── prisma/
│   │   │   └── shared/     ← Shared business logic
│   │   └── main.ts
│   ├── prisma/             ← Database schema
│   ├── test/               ← Tests
│   ├── Dockerfile          ← Full Docker image
│   ├── Dockerfile.whatsapp ← Minimal WhatsApp-only image
│   ├── package.json
│   └── tsconfig.json
├── docker-compose.whatsapp-only.yml  ← WhatsApp container
└── documentation files
```

---

## Quick Start

### Prerequisites
- Node.js 18+
- MySQL 8.0+

### 1. Setup Environment

```bash
cd backend

# Copy environment template
cp .env.example .env

# Update .env with your values
nano .env  # or edit in your editor
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Setup Database

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations
npm run prisma:deploy

# Seed sample data (optional)
npm run prisma:seed
```

### 4. Start Development Server

```bash
# Development with hot reload
npm run start:dev

# Production build & run
npm run build
npm run start:prod
```

### 5. Access Application

```
API:    http://localhost:4000/api
Health: http://localhost:4000/api/health
Docs:   http://localhost:4000/api/docs  (if Swagger enabled)
```

---

## npm Scripts

```bash
# Development
npm run start          # Start production build
npm run start:dev      # Start with hot reload
npm run start:prod     # Run production build
npm run build          # Build for production

# Database
npm run prisma:generate  # Generate Prisma client
npm run prisma:migrate   # Create new migration
npm run prisma:deploy    # Deploy migrations
npm run prisma:seed      # Seed database
npm run prisma:studio    # Open Prisma Studio (GUI)

# Testing
npm test               # Run all tests
npm run test:watch     # Watch mode
npm run test:cov       # Coverage report
npm run test:e2e       # End-to-end tests

# Code Quality
npm run lint           # Lint and fix
```

---

## WhatsApp Setup

### Session Authentication

First run will show QR code in terminal:

```
📱 Scan this QR code with WhatsApp (one-time only):
```

1. Open WhatsApp on your phone
2. Go to **Settings → Linked devices**
3. Click **Link a device**
4. Scan the QR code from terminal

Session is saved in `.wwebjs_auth/` and persists across restarts.

### Test Message

```bash
curl -X POST http://localhost:4000/api/whatsapp/send \
  -H "Content-Type: application/json" \
  -d '{
    "phone":"9876543210",
    "message":"Hello from SSS!"
  }'
```

### Check Status

```bash
curl http://localhost:4000/api/whatsapp/status
```

---

## Docker Deployment (WhatsApp Only)

### Build & Run

```bash
# Start WhatsApp in Docker (API runs locally)
docker-compose -f docker-compose.whatsapp-only.yml up -d

# View logs
docker-compose -f docker-compose.whatsapp-only.yml logs -f

# Stop
docker-compose -f docker-compose.whatsapp-only.yml down
```

### Configuration

Update `docker-compose.whatsapp-only.yml`:

```yaml
environment:
  DATABASE_URL: "mysql://root:password@host.docker.internal:3306/sss"
  NODE_ENV: production
```

---

## Module Organization

### Common Infrastructure (`src/common/`)

Shared decorators, guards, filters, interceptors, middleware:

```
common/
├── decorators/      # @Public, @Roles, @CurrentUser
├── guards/          # JWT, Roles, Permissions
├── filters/         # Exception handlers
├── interceptors/    # Response formatting
├── middleware/      # Request handlers
├── access-control/  # Permission management
├── types/           # TypeScript definitions
├── utils/           # Helper functions
├── constants/       # App constants
└── exceptions/      # Custom exceptions
```

### Feature Modules (`src/modules/`)

Each module follows consistent pattern:

```
module-name/
├── module-name.module.ts      # Module definition
├── module-name.service.ts     # Business logic
├── module-name.controller.ts  # HTTP endpoints
├── dto/                       # Data Transfer Objects
├── entities/                  # Database entities
└── tests/                     # Module tests
```

### Consolidated Modules

**Orders** (`src/modules/orders/`)
- customer/       ← Customer orders
- party/         ← Party orders
- purchase/      ← Purchase orders
- shared/        ← Shared order logic

**Inventory** (`src/modules/inventory/`)
- products/      ← Product management
- raw-materials/ ← Raw material management
- shared/        ← Shared inventory logic

---

## Features (All Preserved)

✅ **Authentication & Authorization**
- JWT-based auth
- Role-based access control
- Module-based permissions

✅ **Order Management**
- Customer orders
- Party orders
- Purchase orders
- Order status tracking

✅ **Inventory Management**
- Products
- Raw materials
- Stock tracking

✅ **WhatsApp Integration**
- Queue-based messaging
- Rate limiting
- Document support
- Group messaging
- Session persistence

✅ **Reporting & Analytics**
- Dashboard
- Reports generation
- Search functionality

✅ **Additional Features**
- PDF generation
- Audit logging
- Payment tracking
- Supplier management
- Carpenter management

---

## Troubleshooting

### "Cannot find module" errors

```bash
# Regenerate Prisma client
npm run prisma:generate

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Database connection failed

```bash
# Check MySQL is running
mysql -u root -p

# Verify DATABASE_URL in .env
# Format: mysql://user:password@localhost:3306/database

# Apply migrations
npm run prisma:deploy
```

### WhatsApp not connecting

- Check terminal for QR code
- Verify `WHATSAPP_ENABLED=true` in .env
- Delete `.wwebjs_auth/` and restart
- Check logs: API should show "WhatsApp client ready"

### Port already in use

```bash
# Windows
netstat -ano | findstr :4000
taskkill /PID <PID> /F

# macOS/Linux
lsof -i :4000
kill -9 <PID>
```

---

## Next Steps

1. ✅ Install dependencies: `npm install`
2. ✅ Setup database: `npm run prisma:deploy`
3. ✅ Start server: `npm run start:dev`
4. ✅ Scan WhatsApp QR code (watch terminal)
5. ✅ Test API: `curl http://localhost:4000/api/health`
6. ✅ Explore: Visit each module in `src/modules/`

---

## Project Structure Comparison

### Before
```
apps/
├── api/          (old structure)
└── web/          (deleted)
```

### After (A2 Pattern)
```
backend/         (new structure)
└── src/
    ├── common/
    ├── config/
    ├── modules/
    └── prisma/
```

---

## All Features Working

Every feature from the old structure is now in the new structure:

| Feature | Old Location | New Location |
|---------|--------------|--------------|
| Orders | customer-orders/, party-orders/ | modules/orders/customer, modules/orders/party |
| Inventory | products/, raw-materials/ | modules/inventory/products, modules/inventory/raw-materials |
| WhatsApp | whatsapp/ | modules/whatsapp/ |
| Users | users/ | modules/users/ |
| Auth | auth/ | modules/auth/ |
| Carpenter | carpenter/ | modules/carpenter/ |
| Payments | payments/ | modules/payments/ |
| Reports | reports/ | modules/reports/ |
| Dashboard | dashboard/ | modules/dashboard/ |
| Audit | audit/ | modules/audit/ |
| PDF | pdf/ | modules/pdf/ |
| Search | search/ | modules/search/ |

All imports updated ✓
All features intact ✓
Structure matches A2 ✓

---

Ready to develop! 🚀
