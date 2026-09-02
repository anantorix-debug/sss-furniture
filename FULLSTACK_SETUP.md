# Full Stack Setup - Backend + Frontend

## Project Structure

```
sss/
├── backend/                 ← NestJS API
│   ├── src/
│   │   ├── common/
│   │   ├── config/
│   │   ├── modules/         (A2 pattern)
│   │   └── main.ts
│   ├── package.json
│   ├── Dockerfile
│   └── Dockerfile.whatsapp
│
├── apps/web/                ← Next.js Frontend
│   ├── src/
│   │   ├── app/
│   │   ├── components/
│   │   ├── lib/
│   │   └── hooks/
│   ├── package.json
│   ├── next.config.ts
│   └── Dockerfile
│
├── docker-compose.whatsapp-only.yml
└── documentation files
```

---

## Setup Instructions

### Step 1: Backend Setup

```bash
cd backend

# Install dependencies
npm install

# Create .env file
cp .env.example .env

# Update DATABASE_URL in .env if needed

# Setup database
npm run prisma:generate
npm run prisma:deploy

# Start backend (keep running)
npm run start:dev
```

**Backend runs on:** `http://localhost:4000/api`

---

### Step 2: Frontend Setup

```bash
cd apps/web

# Install dependencies
npm install

# Create .env.local file
cat > .env.local << 'EOF'
NEXT_PUBLIC_API_URL=http://localhost:4000/api
EOF

# Start frontend
npm run dev
```

**Frontend runs on:** `http://localhost:3000`

---

## API Connection

The frontend is already configured to connect to the backend API.

### Frontend Environment Variables

**File:** `apps/web/.env.local`
```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
```

### API Base URL

**File:** `apps/web/src/lib/api.ts`
```typescript
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
```

---

## Running Full Stack

### Development (Recommended)

**Terminal 1 - Backend:**
```bash
cd backend
npm run start:dev
```

**Terminal 2 - Frontend:**
```bash
cd apps/web
npm run dev
```

**Access:**
- Frontend: http://localhost:3000
- Backend API: http://localhost:4000/api
- Swagger Docs: http://localhost:4000/api/docs

---

### Docker Setup (Optional)

#### Full Stack Docker

```bash
docker-compose up -d
```

This starts both backend and frontend in Docker containers.

#### WhatsApp-Only Docker (API Local)

```bash
# Start WhatsApp container (backend API runs locally)
docker-compose -f docker-compose.whatsapp-only.yml up -d

# Backend still needs to run locally
cd backend && npm run start:dev
```

---

## Available Features

### Frontend Pages

```
/                           ← Login page
/dashboard                  ← Main dashboard
/customer-orders            ← Customer orders
/party-orders               ← Party orders  
/purchase-orders            ← Purchase orders
/carpenters                 ← Carpenter management
/inventory                  ← Products & materials
/suppliers                  ← Supplier management
/payments                   ← Payment tracking
/reports                    ← Reports & analytics
/users                      ← User management
/audit-log                  ← Audit logging
/settings/whatsapp          ← WhatsApp settings
```

### Backend API Endpoints

```
POST   /api/auth/login              ← Login
POST   /api/auth/refresh            ← Refresh token
POST   /api/users                   ← Create user
GET    /api/users                   ← List users
GET    /api/customer-orders         ← Get customer orders
POST   /api/customer-orders         ← Create customer order
POST   /api/whatsapp/send           ← Send WhatsApp message
GET    /api/dashboard               ← Dashboard data
... and many more
```

---

## npm Scripts

### Backend

```bash
cd backend

npm run start:dev          # Development server
npm run build              # Build
npm run start:prod         # Production

npm run prisma:migrate     # Create migration
npm run prisma:deploy      # Deploy migrations
npm run prisma:seed        # Seed data
npm run prisma:studio      # GUI database viewer

npm test                   # Run tests
npm run lint               # Lint code
```

### Frontend

```bash
cd apps/web

npm run dev                # Development server
npm run build              # Build
npm start                  # Production server
npm run lint               # Lint code
```

---

## Frontend - Backend Communication

### How it Works

1. **Frontend** sends HTTP request to Backend API
2. **Backend** processes request and returns JSON response
3. **Frontend** displays data to user

### Example: Get Customer Orders

**Frontend** (apps/web/src/lib/api.ts):
```typescript
const response = await fetch(
  `${API_URL}/customer-orders`
);
```

**Backend** (backend/src/modules/orders/customer/customer-orders.controller.ts):
```typescript
@Get()
async findAll() {
  return this.service.findAll();
}
```

**Response:**
```json
[
  {
    "id": "123",
    "customerId": "456",
    "status": "PENDING",
    "total": 5000,
    "items": [...]
  }
]
```

---

## Environment Files

### Backend (.env)

```env
DATABASE_URL=mysql://root:root@localhost:3306/sss
PORT=4000
NODE_ENV=development
JWT_ACCESS_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret
SUPERADMIN_EMAIL=admin@sss.com
SUPERADMIN_PASSWORD=ChangeMe123!

WHATSAPP_ENABLED=true
WWEBJS_AUTH_PATH=.wwebjs_auth
WHATSAPP_MIN_DELAY_MS=4000
WHATSAPP_MAX_DELAY_MS=9000
WHATSAPP_MAX_PER_RECIPIENT_PER_DAY=5
WHATSAPP_MAX_PER_HOUR=30
```

### Frontend (.env.local)

```env
NEXT_PUBLIC_API_URL=http://localhost:4000/api
```

---

## Troubleshooting

### "Cannot connect to API"

**Check:**
1. Backend is running: `npm run start:dev` in `backend/` folder
2. Backend is on `http://localhost:4000`
3. Frontend `NEXT_PUBLIC_API_URL` is correct in `.env.local`

**Solution:**
```bash
# Terminal 1 - Backend
cd backend
npm install
npm run start:dev

# Terminal 2 - Frontend  
cd apps/web
npm install
npm run dev
```

### "Database error"

**Check:**
1. MySQL is running
2. DATABASE_URL in backend/.env is correct
3. Database exists: `mysql -u root -p`

**Solution:**
```bash
cd backend
npm run prisma:deploy    # Deploy migrations
npm run prisma:seed      # Seed data
```

### "Module not found" errors

**Solution:**
```bash
# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install

# Regenerate Prisma
npm run prisma:generate
```

### Frontend not loading styles

**Solution:**
```bash
# Rebuild frontend
npm run build

# Or just restart dev server
npm run dev
```

---

## Development Workflow

### 1. Make Backend Changes

```bash
cd backend
# Edit files in src/modules/

# Changes auto-reload with npm run start:dev
```

### 2. Make Frontend Changes

```bash
cd apps/web  
# Edit files in src/

# Changes auto-reload with npm run dev
```

### 3. Test API Endpoint

```bash
# Manual test with curl
curl -X GET http://localhost:4000/api/customer-orders \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### 4. Test Frontend

```bash
# Open browser
http://localhost:3000
```

---

## Production Deployment

### Backend Deployment

```bash
cd backend

# Build
npm run build

# Run production
npm run start:prod
```

### Frontend Deployment

```bash
cd apps/web

# Build
npm run build

# Run production
npm start
```

### Docker Deployment

```bash
# Full stack
docker-compose up -d

# Or WhatsApp-only
docker-compose -f docker-compose.whatsapp-only.yml up -d
```

---

## Quick Start (TL;DR)

```bash
# Terminal 1
cd backend
npm install
npm run prisma:deploy
npm run start:dev

# Terminal 2
cd apps/web
npm install
npm run dev

# Open browser
# http://localhost:3000
```

---

## Architecture

```
┌─────────────────────────────────────┐
│         Web Browser                 │
│      http://localhost:3000          │
└──────────────┬──────────────────────┘
               │ HTTP/JSON
               ▼
┌─────────────────────────────────────┐
│      Next.js Frontend               │
│      (apps/web)                     │
├─────────────────────────────────────┤
│ - React Components                  │
│ - API Calls to Backend              │
│ - User Interface                    │
└──────────────┬──────────────────────┘
               │ API Requests
               │ (http://localhost:4000/api)
               ▼
┌─────────────────────────────────────┐
│      NestJS Backend                 │
│      (backend)                      │
├─────────────────────────────────────┤
│ - Authentication & Authorization    │
│ - Business Logic                    │
│ - Database Operations               │
│ - WhatsApp Integration              │
└──────────────┬──────────────────────┘
               │
               ▼
┌─────────────────────────────────────┐
│      MySQL Database                 │
│      (localhost:3306)               │
└─────────────────────────────────────┘
```

---

## Next Steps

1. ✅ Install backend dependencies: `cd backend && npm install`
2. ✅ Setup database: `npm run prisma:deploy`
3. ✅ Start backend: `npm run start:dev`
4. ✅ Install frontend dependencies: `cd apps/web && npm install`
5. ✅ Start frontend: `npm run dev`
6. ✅ Open http://localhost:3000
7. ✅ Login with super admin credentials

---

## Support

- **Setup Issues:** See BACKEND_SETUP.md
- **API Documentation:** http://localhost:4000/api/docs (when running)
- **Frontend Issues:** Check apps/web/src/lib/api.ts for API configuration

Ready to develop! 🚀
