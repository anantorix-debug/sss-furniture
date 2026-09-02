# SSS Furniture — Production Deployment Guide

## Live URLs

- **Dashboard (frontend)**: https://admin.sssfurniture.co.in
- **API (backend)**: https://api.sssfurniture.co.in/api

Both are served over HTTPS with a Let's Encrypt certificate (auto-renews via certbot's systemd timer — no action needed).

The root domain `sssfurniture.co.in` points to a different host (185.230.63.171 / .186) and is **not** part of this deployment — only the `admin.` and `api.` subdomains are served by this server.

## Server

- Host: `187.53.132.7` (Ubuntu 26.04 LTS)
- Access: `ssh root@187.53.132.7`
- Firewall (UFW): only ports 22 (SSH), 80 (HTTP), 443 (HTTPS) are open

## Login

- Email: `admin@sssfurniture.co.in`
- Password: set during initial deployment — **change it immediately from Profile settings if you haven't already**, since it was shared in plaintext during setup.
- The production database starts clean: real schema, no demo/sample data, just this one Super Admin account.

## WhatsApp

The production server runs its own WhatsApp session, independent of any local dev session. Go to **Settings → WhatsApp** on the live dashboard and scan the QR code to connect it.

## Architecture

No Docker for the application processes — everything runs natively, managed by PM2:

| Component | Runs as | Port | Notes |
|---|---|---|---|
| Backend (NestJS) | PM2 process `sss-backend` | 4000 | Built to `backend/dist`, `node dist/src/main.js` |
| Frontend (Next.js) | PM2 process `sss-frontend` | 3000 | Built to `frontend/.next`, `npm run start` |
| Database | MySQL 8.4 (native service) | 3306 (localhost only) | Dedicated `sss_app` user, not root |
| WhatsApp Chromium | Puppeteer's own bundled Chromium | — | Not the OS/snap Chromium — snap sandboxing breaks running as root |
| Reverse proxy | Nginx | 80 / 443 | Terminates TLS, proxies to `127.0.0.1:3000` and `127.0.0.1:4000` |

PM2 is configured to relaunch both processes automatically on server reboot (`pm2 startup` + `pm2 save` already applied).

### File locations on the server

- App code: `/opt/sss` (git checkout of this repo)
- Backend env vars: `/opt/sss/backend/.env` (chmod 600 — DB URL, JWT secrets, WhatsApp config)
- Generated secrets (DB password, JWT secrets, initial Super Admin password): `/root/.sss_secrets` (chmod 600, root-only)
- WhatsApp session: `/opt/sss/backend/.wwebjs_auth`
- Uploaded product images: `/opt/sss/backend/uploads`
- Nginx site configs: `/etc/nginx/sites-available/admin.sssfurniture.co.in` and `.../api.sssfurniture.co.in`
- TLS certificates: `/etc/letsencrypt/live/admin.sssfurniture.co.in/`

## Useful commands

```bash
ssh root@187.53.132.7

pm2 status                    # see both processes
pm2 logs sss-backend          # tail backend logs
pm2 logs sss-frontend         # tail frontend logs
pm2 restart sss-backend       # restart after a config/env change
pm2 restart sss-frontend

systemctl status nginx        # reverse proxy status
nginx -t && systemctl reload nginx   # after editing an nginx config

mysql -u sss_app -p sss       # connect to the app database (password in /root/.sss_secrets)
```

## Deploying updates

```bash
ssh root@187.53.132.7
cd /opt/sss
git pull origin main

cd backend
npm ci
npx prisma generate
npx prisma db push          # syncs schema changes — review before running against real data
npm run build
pm2 restart sss-backend

cd ../frontend
npm ci
npm run build
pm2 restart sss-frontend
```

> `prisma db push` is non-interactive schema sync (this project has no migration history — see `backend/prisma/schema.prisma`). For a schema change that could drop or alter columns with real data in them, check the diff first with `npx prisma migrate diff` or review the change manually before pushing.

## Security notes

- The GitHub remote for this repo had a personal access token embedded in its HTTPS URL (visible via `git remote -v` locally). The token was stripped from the server's copy of the remote after cloning, but the local remote still has it — rotate that token on GitHub when convenient, since it was exposed in chat during setup.
- The server's root SSH password was also shared in chat during setup — consider switching to key-based SSH auth and disabling password auth, or at least rotating the password.
