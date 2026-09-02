# Backend Restructuring Plan - Follow A2 Pattern

## Current State
```
sss/
├── apps/
│   ├── api/           ← KEEP & RESTRUCTURE
│   │   └── src/
│   │       ├── audit/
│   │       ├── auth/
│   │       ├── carpenter/
│   │       ├── common/
│   │       ├── whatsapp/
│   │       └── ...
│   └── web/           ← DELETE (frontend not needed)
├── package.json       ← Update (remove web)
└── ...
```

## Target State (Like A2)
```
sss/
├── backend/           ← Rename from apps/api
│   ├── src/
│   │   ├── common/
│   │   │   ├── decorators/
│   │   │   ├── guards/
│   │   │   ├── filters/
│   │   │   ├── interceptors/
│   │   │   ├── middleware/
│   │   │   ├── types/
│   │   │   ├── utils/
│   │   │   ├── constants/
│   │   │   ├── exceptions/
│   │   │   └── access-control/
│   │   ├── config/
│   │   ├── modules/
│   │   │   ├── auth/
│   │   │   ├── users/
│   │   │   ├── whatsapp/
│   │   │   ├── carpenter/
│   │   │   ├── orders/
│   │   │   ├── suppliers/
│   │   │   ├── products/
│   │   │   ├── shared/
│   │   │   └── ...
│   │   ├── prisma/
│   │   └── main.ts
│   ├── prisma/
│   ├── Dockerfile
│   ├── Dockerfile.whatsapp
│   ├── package.json
│   └── tsconfig.json
└── ...
```

## Changes

### Phase 1: Delete Unnecessary Files
```bash
# Remove web app (frontend)
rm -rf apps/web

# Remove old scripts
rm -f setup-local.ps1
rm -f setup-local.sh
rm -f deploy.ps1

# Remove root package.json (not needed)
rm -f package.json
```

### Phase 2: Reorganize API Structure
```bash
# Move api to backend
mv apps/api backend

# Remove now-empty apps directory
rm -rf apps

# Update src/common to match A2
# Add missing folders to common:
#   - filters/
#   - interceptors/
#   - middleware/
#   - exceptions/
#   - constants/

# Add src/config folder
mkdir -p backend/src/config

# Consolidate related modules
# Example: merge party-orders, customer-orders into orders/
```

### Phase 3: Update Files
```bash
# Update backend/package.json
# Update backend/tsconfig.json
# Update docker-compose files
# Update documentation
```

---

## Folder Structure Details

### src/common/ (Shared Infrastructure)
```
common/
├── decorators/              # @Public, @Roles, @CurrentUser
│   ├── public.decorator.ts
│   ├── roles.decorator.ts
│   ├── current-user.decorator.ts
│   └── require-permission.decorator.ts
├── guards/                  # JWT, Roles, Permissions
│   ├── jwt-auth.guard.ts
│   ├── roles.guard.ts
│   └── module-permission.guard.ts
├── filters/                 # Exception handlers
│   └── http-exception.filter.ts
├── interceptors/            # Response formatting
│   └── response.interceptor.ts
├── middleware/              # Request handlers
│   └── swagger-auth.middleware.ts
├── access-control/          # Permission management
│   ├── access-control.module.ts
│   ├── access-control.service.ts
│   └── types/
├── types/                   # TypeScript definitions
│   ├── express.d.ts
│   ├── pagination.ts
│   └── api-response.ts
├── utils/                   # Helper functions
│   ├── phone.util.ts        # Phone normalization
│   ├── date.util.ts         # Date helpers
│   ├── validation.util.ts   # Custom validators
│   └── file.util.ts         # File operations
├── constants/               # App constants
│   ├── app.constants.ts
│   ├── error-codes.ts
│   └── order-types.ts
└── exceptions/              # Custom exceptions
    ├── base.exception.ts
    ├── validation.exception.ts
    └── business.exception.ts
```

### src/config/ (Configuration)
```
config/
├── index.ts                 # Main configuration
├── types.ts                 # Config type definitions
├── database.config.ts       # Database settings
├── jwt.config.ts            # JWT settings
└── whatsapp.config.ts       # WhatsApp settings
```

### src/modules/ (Features)
```
modules/
├── auth/                    # Authentication
│   ├── auth.module.ts
│   ├── auth.service.ts
│   ├── auth.controller.ts
│   ├── strategies/
│   ├── dto/
│   └── entities/
├── users/                   # User management
│   ├── users.module.ts
│   ├── users.service.ts
│   ├── users.controller.ts
│   ├── dto/
│   └── entities/
├── orders/                  # Consolidated orders
│   ├── orders.module.ts
│   ├── customer/            # Customer orders
│   ├── party/               # Party orders
│   ├── shared/              # Shared order logic
│   └── dto/
├── inventory/               # Products + Raw Materials
│   ├── products/
│   ├── raw-materials/
│   ├── shared/              # Shared logic
│   └── dto/
├── suppliers/               # Supplier management
│   ├── suppliers.module.ts
│   ├── suppliers.service.ts
│   ├── dto/
│   └── entities/
├── carpenter/               # Carpenter management
│   ├── carpenter.module.ts
│   ├── carpenter.service.ts
│   ├── dto/
│   └── entities/
├── whatsapp/                # WhatsApp integration
│   ├── whatsapp.module.ts
│   ├── whatsapp.service.ts
│   ├── whatsapp.controller.ts
│   ├── whatsapp-client.ts
│   ├── whatsapp-queue.ts
│   ├── whatsapp-gateway.ts
│   ├── dto/
│   └── entities/
├── payments/                # Payment management
│   ├── payments.module.ts
│   ├── payments.service.ts
│   ├── dto/
│   └── entities/
├── reports/                 # Reporting
│   ├── reports.module.ts
│   ├── reports.service.ts
│   └── dto/
├── dashboard/               # Dashboard
│   ├── dashboard.module.ts
│   ├── dashboard.service.ts
│   ├── dashboard.controller.ts
│   └── dto/
├── search/                  # Search functionality
│   ├── search.module.ts
│   ├── search.service.ts
│   └── dto/
├── audit/                   # Audit logging
│   ├── audit.module.ts
│   ├── audit.service.ts
│   ├── audit.decorator.ts
│   ├── dto/
│   └── entities/
├── pdf/                     # PDF generation
│   ├── pdf.module.ts
│   ├── pdf.service.ts
│   └── templates/
└── shared/                  # Shared business logic (NEW)
    ├── shared.module.ts
    ├── services/
    │   ├── order-helper.service.ts
    │   ├── inventory-helper.service.ts
    │   └── calculation.service.ts
    ├── strategies/
    └── pipes/
```

---

## Module Consolidation Strategy

### Before: Duplicate Logic
```
party-orders/
  └── party-orders.service.ts

customer-orders/
  └── customer-orders.service.ts

(Both have similar order creation, status management, etc.)
```

### After: Shared Logic
```
orders/
├── customer/
│   ├── customer-orders.service.ts   (uses shared logic)
│   ├── customer-orders.controller.ts
│   └── dto/
├── party/
│   ├── party-orders.service.ts      (uses shared logic)
│   ├── party-orders.controller.ts
│   └── dto/
├── shared/
│   ├── order.base-service.ts        (base logic)
│   ├── order.helper.ts              (utilities)
│   └── order.strategies.ts          (common patterns)
└── orders.module.ts
```

---

## Similar Consolidations

### Inventory
```
Before:
  products/
  raw-materials/

After:
  inventory/
  ├── products/
  ├── raw-materials/
  ├── shared/          (common inventory logic)
  └── inventory.module.ts
```

### Payments
```
Before:
  payments/ (if exists)

After:
  payments/
  ├── deposits/
  ├── expenses/
  ├── shared/          (common payment logic)
  └── payments.module.ts
```

---

## Package.json Structure

### Root level: REMOVE
Currently has scripts for both api and web
Remove it entirely as it's no longer needed

### Backend/package.json: UPDATE
```json
{
  "name": "sss-backend",
  "version": "1.0.0",
  "description": "SSS Company ERP Backend API",
  "scripts": {
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main",
    "build": "nest build",
    "lint": "eslint \"{src,test}/**/*.ts\" --fix",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy",
    "prisma:seed": "ts-node prisma/seed.ts",
    "prisma:studio": "prisma studio",
    "db:setup": "npm run prisma:migrate && npm run prisma:seed",
    "db:reset": "prisma migrate reset --force"
  }
}
```

---

## Docker Updates

### Keep:
- `Dockerfile` (updated path references)
- `Dockerfile.whatsapp` (updated path references)
- `docker-compose.whatsapp-only.yml` (updated path references)

### Remove:
- `docker-compose.yml` (full stack - no longer needed)
- Root `docker-compose.yml` references

### Update:
```yaml
# docker-compose.whatsapp-only.yml
services:
  whatsapp:
    build:
      context: ./backend      # Changed from ./apps/api
      dockerfile: Dockerfile.whatsapp
    # ... rest of config
```

---

## Documentation Updates

### Keep & Update:
- `SETUP_GUIDE.md` → Update paths
- `QUICK_REFERENCE.md` → Update commands
- `ARCHITECTURE.md` → Update diagrams
- `WHATSAPP_SESSION_REFACTOR.md` → No changes

### Delete:
- `setup-local.ps1` → No longer needed
- `setup-local.sh` → No longer needed
- `deploy.ps1` → Simplify for backend only

### New Files:
- `BACKEND_STRUCTURE.md` → Backend folder organization
- `BACKEND_SETUP.md` → Backend-only setup

---

## Implementation Order

### Step 1: Preparation
- [ ] Create backup branch
- [ ] Review all current code

### Step 2: Restructure API
- [ ] Create new folder structure
- [ ] Move files to new locations
- [ ] Update import paths

### Step 3: Consolidate Modules
- [ ] Move related modules together
- [ ] Create shared folders
- [ ] Extract common logic

### Step 4: Delete Unnecessary
- [ ] Remove web app
- [ ] Remove root package.json
- [ ] Remove old scripts
- [ ] Remove old docs

### Step 5: Update Files
- [ ] Update all package.json
- [ ] Update Dockerfile paths
- [ ] Update docker-compose files
- [ ] Update documentation

### Step 6: Test
- [ ] Run `npm install`
- [ ] Build: `npm run build`
- [ ] Test: `npm test`
- [ ] Start: `npm run start:dev`

### Step 7: Commit
- [ ] Single clean commit
- [ ] Update documentation

---

## Expected Improvements

After restructuring:

✅ **Cleaner** - Only backend, no frontend
✅ **Organized** - Follows A2 structure
✅ **Maintainable** - Clear module organization
✅ **Scalable** - Shared logic layer
✅ **Consistent** - Same patterns as A2
✅ **Reduced duplication** - Consolidated modules
✅ **Better team experience** - Clear structure

---

## Questions to Clarify

1. Should we keep `apps/` directory structure or flatten to just `backend/`?
   - Recommendation: Flatten to `backend/` (cleaner)

2. Should we consolidate party-orders and customer-orders into orders/?
   - Recommendation: Yes, create shared order logic

3. Should we create a shared/ module for common business logic?
   - Recommendation: Yes, extract helpers, strategies, pipes

4. Update to A2's access-control patterns?
   - Recommendation: Yes, but gradual migration

---

## Timeline

- **Day 1**: Restructure folders, update imports
- **Day 2**: Consolidate modules, extract shared logic
- **Day 3**: Update documentation, test thoroughly
- **Day 4**: Review, optimize, final commit

---

Ready to proceed? Reply with:
- ✅ Proceed with restructuring
- 🤔 Need clarifications (specify which)
- ⏸️ Wait, need to discuss first
