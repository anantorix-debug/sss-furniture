# Architecture & Deployment Diagrams

## Local Development Architecture

```
Your Machine
═════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────┐
│                   WEB BROWSER                        │
│              http://localhost:3000                   │
└────────────────────┬────────────────────────────────┘
                     │ HTTP/WebSocket
                     │
         ┌───────────┴────────────┐
         │                        │
    ┌────▼─────────┐      ┌──────▼──────────┐
    │   NEXT.JS    │      │   NESTJS API    │
    │   PORT 3000  │      │   PORT 4000     │
    │   (dev)      │      │   (dev)         │
    └────┬─────────┘      └────┬─────────┬──┘
         │                     │         │
         │          ┌──────────┘         │
         │          │                    │
    ┌────▼──────────▼──┐        ┌────────▼──────────┐
    │    MYSQL 8.0     │        │  CHROMIUM/PUPPETEER
    │  PORT 3306       │        │  (WhatsApp Web)
    │  Local Database  │        │  .wwebjs_auth/
    └──────────────────┘        └─────────────────┘
                                        │
                                        │ WebSocket
                                        │
                                 ┌──────▼───────┐
                                 │  WHATSAPP    │
                                 │  (Session)   │
                                 └──────────────┘
```

### Setup Steps
1. Install Node.js + MySQL locally
2. Run `npm run setup:local`
3. Start API: `npm run dev:api`
4. Start Web: `npm run dev:web`
5. Scan WhatsApp QR code

### Advantages
- ✅ No Docker overhead
- ✅ Fast iteration
- ✅ Easy debugging
- ✅ Direct database access
- ✅ Full control

---

## Docker Full Stack Architecture

```
DOCKER NETWORK
═════════════════════════════════════════════════════════

                    Your Machine
                    ┌──────────────────┐
                    │  WEB BROWSER     │
                    │ :3001, :4000     │
                    └────────┬─────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
   ┌────▼──────────┐  ┌──────▼────────┐  ┌───────▼─────────┐
   │  WEB CONTAINER│  │ API CONTAINER │  │ DB CONTAINER    │
   │  :3001        │  │ :4000         │  │ :3307           │
   │ (Next.js)     │  │ (NestJS)      │  │ (MySQL 8.0)     │
   │               │  │               │  │                 │
   │ Volume:       │  │ Volume:       │  │ Volume:         │
   │ .next/        │  │ .wwebjs_auth/ │  │ db_data/        │
   │ node_modules/ │  │               │  │                 │
   │               │  │ Chromium for  │  │ Persists data   │
   │               │  │ WhatsApp Web  │  │ between restarts│
   │               │  │               │  │                 │
   └───────────────┘  └──────┬────────┘  └─────────────────┘
                             │
                     (Docker Bridge Network)
                             │
                      WhatsApp Web.js
                             │
                        ┌─────▼──────┐
                        │  WHATSAPP  │
                        │  (Session) │
                        └────────────┘
```

### Startup Commands
```bash
npm run docker:full      # Start all services
npm run docker:logs      # View logs
npm run docker:down      # Stop all
```

### Access Points
- Web UI: http://localhost:3001
- API: http://localhost:4000/api
- Swagger: http://localhost:4000/api/docs
- Database: mysql://root:root@localhost:3307/sss

### Advantages
- ✅ Consistent across machines
- ✅ Easy deployment
- ✅ Production-like environment
- ✅ Good for testing
- ✅ Single command to start

---

## WhatsApp-Only Docker (Production)

```
PRODUCTION SETUP
═════════════════════════════════════════════════════════

           VPS / Cloud Server
        ┌──────────────────────────┐
        │                          │
        │  ┌────────────────────┐  │
        │  │  NESTJS API        │  │
        │  │  PORT 4000         │  │
        │  │  (Node.js Direct)  │  │
        │  │  - Routes          │  │
        │  │  - Business Logic  │  │
        │  │  - Database calls  │  │
        │  └────────────────────┘  │
        │           │              │
        │           │ mysql://     │
        │           ▼              │
        │  ┌────────────────────┐  │
        │  │  MYSQL 8.0         │  │
        │  │  PORT 3306         │  │
        │  │  Local connection  │  │
        │  └────────────────────┘  │
        │                          │
        └──────────────┬───────────┘
                       │ localhost:4001
        ┌──────────────▼───────────┐
        │  DOCKER CONTAINER        │
        │  ┌────────────────────┐  │
        │  │ NESTJS (Minimal)   │  │
        │  │ WhatsApp Only      │  │
        │  │ PORT 4000 → 4001   │  │
        │  │                    │  │
        │  │ Chromium           │  │
        │  │ WhatsApp Web.js    │  │
        │  │ .wwebjs_auth/      │  │
        │  └────────────────────┘  │
        │           │              │
        │           ▼              │
        │     host.docker.internal │
        │        :3306            │
        │   (connects to local DB) │
        │                          │
        └──────────────────────────┘
                    ▲
            Connects via bridge
            to local MySQL


Client / Frontend
     ▲
     │ API requests
     │ http://vps:4000/api
     ▼
VPS API → WhatsApp Container (for WhatsApp messages)
     ↓
   MySQL (local)
```

### Setup Steps
```bash
# On VPS
npm run dev:api              # API in foreground
npm run docker:whatsapp      # WhatsApp in Docker

# Or with PM2
pm2 start "npm run start:prod" --name sss-api
npm run docker:whatsapp
```

### Advantages
- ✅ API runs directly (no Docker overhead)
- ✅ WhatsApp isolated with chromium
- ✅ Smaller resource footprint
- ✅ Easier debugging
- ✅ Direct database access for API

---

## Module Dependency Graph

```
APPLICATION LAYERS
═════════════════════════════════════════════════════════

                    ┌─────────────┐
                    │  CONTROLLER │
                    │  (HTTP API) │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │   SERVICE   │
                    │  (Business) │
                    └──────┬──────┘
                           │
                ┌──────────┴─────────────┐
                │                        │
         ┌──────▼──────┐        ┌───────▼────┐
         │   PRISMA    │        │  EXTERNAL  │
         │   ORM       │        │  SERVICES  │
         └──────┬──────┘        └────────────┘
                │
         ┌──────▼──────┐
         │   DATABASE  │
         │   (MySQL)   │
         └─────────────┘


WHATSAPP MODULE STRUCTURE
═════════════════════════════════════════════════════════

    ┌─────────────────────────────────────────┐
    │      WHATSAPP MODULE                    │
    ├─────────────────────────────────────────┤
    │                                         │
    │  WhatsAppController                     │
    │  ├─ POST /send                          │
    │  ├─ POST /send-document                 │
    │  ├─ GET /status                         │
    │  └─ GET /qr-code                        │
    │                                         │
    │          │                              │
    │          ▼                              │
    │  WhatsAppService                        │
    │  ├─ sendMessage()                       │
    │  ├─ sendDocument()                      │
    │  ├─ getStatus()                         │
    │  └─ queue management                    │
    │                                         │
    │          │                              │
    │          ▼                              │
    │  WhatsAppClientWrapper                  │
    │  ├─ Client initialization               │
    │  ├─ QR code handling                    │
    │  ├─ Session management                  │
    │  ├─ Connection state                    │
    │  └─ Error handling                      │
    │                                         │
    │          │                              │
    │          ▼                              │
    │  whatsapp-web.js (Library)              │
    │  ├─ Client class                        │
    │  ├─ LocalAuth strategy                  │
    │  └─ Puppeteer integration               │
    │                                         │
    │          │                              │
    │          ▼                              │
    │  Chromium + Puppeteer                   │
    │  └─ Browser automation                  │
    │                                         │
    └─────────────────────────────────────────┘
            │
            ▼
     ┌─────────────────┐
     │   WhatsApp      │
     │   Servers       │
     └─────────────────┘
```

---

## Request Flow - Send Message

```
USER REQUEST
═════════════════════════════════════════════════════════

1. Client sends HTTP POST
   ┌─────────────────────────────────┐
   │ POST /api/whatsapp/send         │
   │ {                               │
   │   "phone": "9876543210",        │
   │   "message": "Hello"            │
   │ }                               │
   └────────────┬────────────────────┘
                │
                ▼
   ┌────────────────────────────────────┐
   │  WhatsAppController.send()         │
   │  - Validate input                  │
   │  - Normalize phone number          │
   └────────────┬───────────────────────┘
                │
                ▼
   ┌────────────────────────────────────┐
   │  WhatsAppService.send()            │
   │  - Check rate limits               │
   │  - Queue message                   │
   │  - Return queued status            │
   └────────────┬───────────────────────┘
                │
                ▼
   ┌────────────────────────────────────┐
   │  WhatsAppQueue                     │
   │  - Add to queue                    │
   │  - Process with delays             │
   └────────────┬───────────────────────┘
                │
                ▼
   ┌────────────────────────────────────┐
   │  WhatsAppClientWrapper             │
   │  - Send via web.js                 │
   │  - Handle errors                   │
   │  - Log result                      │
   └────────────┬───────────────────────┘
                │
                ▼
   ┌────────────────────────────────────┐
   │  WhatsApp Web.js sends to WhatsApp │
   │  servers                           │
   └────────────┬───────────────────────┘
                │
                ▼
   ┌────────────────────────────────────┐
   │  ✓ Message delivered to recipient  │
   └────────────────────────────────────┘
```

### Queue Processing
```
Queue Flow:
═════════════════════════════════════════════════════════

  New Message
      │
      ▼
  ┌──────────────┐
  │ Check limits │  Max per hour?
  │              │  Max per person?
  └────┬─────────┘
       │
       ├─ No → Add to queue
       │
       └─ Yes → Return error

  Queue:
  ┌─────────────────────────────────┐
  │ Message 1 (4s delay)            │
  │ Message 2 (6s delay)            │
  │ Message 3 (5s delay)            │
  │ Message 4 (7s delay)            │
  │ ...                             │
  └────┬────────────────────────────┘
       │
       │ Process one at a time
       │ with configured delays
       │
       ▼
  ┌─────────────────────────────────┐
  │ Send via Web.js                 │
  │ - Handle transient errors       │
  │ - Log success/failure           │
  │ - Update message status         │
  └─────────────────────────────────┘
```

---

## Database Schema Summary

```
USERS & AUTHENTICATION
═════════════════════════════════════════════════════════

User
├─ id (PK)
├─ email
├─ password (hashed)
├─ name
├─ role
├─ permissions
└─ createdAt

Carpenter
├─ id (PK)
├─ name
├─ phone
├─ email
├─ specialization
├─ active
└─ userId (FK)

Supplier
├─ id (PK)
├─ name
├─ phone
├─ email
├─ companyName
├─ active
└─ createdAt


ORDERS & INVENTORY
═════════════════════════════════════════════════════════

CustomerOrder
├─ id (PK)
├─ customerId
├─ orderDate
├─ total
├─ status
├─ items (JSON)
└─ createdAt

PurchaseOrder
├─ id (PK)
├─ supplierId
├─ poNumber
├─ total
├─ status
├─ items (JSON)
└─ createdAt

Product
├─ id (PK)
├─ name
├─ price
├─ stock
├─ category
└─ createdAt


COMMUNICATION
═════════════════════════════════════════════════════════

WhatsAppMessage
├─ id (PK)
├─ phone
├─ message
├─ status (queued, sent, failed)
├─ sentAt
└─ createdAt

AuditLog
├─ id (PK)
├─ userId
├─ action
├─ entity
├─ changes
└─ timestamp
```

---

## Deployment Decision Tree

```
WHERE DO YOU WANT TO DEPLOY?

                    ┌─ LOCAL MACHINE ─┐
                    │  Development    │
                    │  ✓ Fast         │
                    │  ✓ Full control │
                    │  ✗ No production│
                    │                 │
                    ├─ Docker Desktop ┤
                    │  Testing        │
                    │  ✓ Reproducible │
                    │  ✓ Quick test   │
                    │  ✗ Not prod     │
                    │                 │
                    ├─ VPS / Server   ┤
                    │  Production     │
                    │  ✓ 24/7 running │
                    │  ✓ Scalable     │
                    │  ✗ More complex │
                    │                 │
                    └─ Managed Cloud ─┘
                       (AWS, Vercel)
                       ✓ Fully managed
                       ✗ Vendor lock-in

        Need WhatsApp?
        │
        ├─ YES ──┬─ Docker OK? ──┬─ YES → WhatsApp in Docker
        │        │                └─ NO  → WhatsApp on VPS
        │        └─ If performance critical
        │           → Chromium overhead
        │           → Consider Node.js direct
        │
        └─ NO ──┐ Keep everything local
                └─ Or use managed services
```

---

## File Upload Flow

```
Document Upload
═════════════════════════════════════════════════════════

1. User uploads file
   ┌──────────────────────┐
   │ Form: file binary    │
   │ To: /api/upload      │
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ Upload Controller    │
   │ - Validate file      │
   │ - Check size limit   │
   │ - Check MIME type    │
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────────┐
   │ Upload to Cloudinary     │
   │ - Secure hosting         │
   │ - CDN delivery           │
   │ - Returns public URL     │
   └──────────┬───────────────┘
              │
              ▼
   ┌──────────────────────────┐
   │ Save to Database         │
   │ - Store URL              │
   │ - Store metadata         │
   │ - Link to entity         │
   └──────────┬───────────────┘
              │
              ▼
   ✓ Return to client
   (URL, metadata, etc)
```

---

## Environment Variable Scope

```
LOCAL DEVELOPMENT (.env.local)
═════════════════════════════════════════════════════════
DATABASE_URL=mysql://root:root@localhost:3306/sss
PORT=4000
NODE_ENV=development
WHATSAPP_ENABLED=true
CORS_ORIGIN=http://localhost:3000
JWT_ACCESS_SECRET=dev-secret


DOCKER (.env in docker-compose.yml)
═════════════════════════════════════════════════════════
DATABASE_URL=mysql://root:root@db:3306/sss
PORT=4000
NODE_ENV=production
WHATSAPP_ENABLED=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium


PRODUCTION (.env.production on VPS)
═════════════════════════════════════════════════════════
DATABASE_URL=mysql://prod_user:strong_pass@rds.aws:3306/sss
PORT=4000
NODE_ENV=production
WHATSAPP_ENABLED=true
CORS_ORIGIN=https://yourdomain.com
JWT_ACCESS_SECRET=strong-random-secret-from-vault
JWT_REFRESH_SECRET=strong-random-secret-from-vault
```

---

## This diagram format helps you understand:

✅ **Local Dev** - How components connect locally
✅ **Docker Full Stack** - All services in containers
✅ **Docker WhatsApp** - Hybrid approach for production
✅ **Module Dependencies** - How code is organized
✅ **Request Flow** - How a message gets sent
✅ **Database Schema** - What data is stored
✅ **Decision Tree** - Where to deploy based on needs
✅ **File Uploads** - How files are handled

Use these diagrams to:
- Explain architecture to new team members
- Troubleshoot connection issues
- Plan infrastructure
- Understand data flow
- Debug request paths
