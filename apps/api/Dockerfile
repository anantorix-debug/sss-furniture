# syntax=docker/dockerfile:1

FROM node:22-bookworm-slim AS base
# whatsapp-web.js needs a real Chromium; use the distro package instead of
# letting puppeteer download its own (smaller image, works well on slim).
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
RUN npm install

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
CMD ["npm", "run", "start:prod"]
