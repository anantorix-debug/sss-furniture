# syntax=docker/dockerfile:1
# ============================================================================
# SSS Backend - NestJS API with WhatsApp Web.js integration
# ============================================================================
# Multi-stage build: installs deps once, builds once, ships a lean runtime
# image with only production deps + compiled output + a real Chromium
# (whatsapp-web.js/puppeteer need it; the distro package is smaller and
# faster than letting puppeteer download its own).

FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npx prisma generate
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY package.json ./

RUN mkdir -p /app/.wwebjs_auth
VOLUME ["/app/.wwebjs_auth"]

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 --start-period=10s \
  CMD node -e "require('http').get('http://localhost:4000/api/health', (r) => {if (r.statusCode !== 200) throw new Error(r.statusCode)})"

CMD ["npm", "run", "start:prod"]
