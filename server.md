# Server Access And Deploy Notes

This file is the operational source of truth for deploys, production checks, and server access.
The current production host is managed over plain SSH and runs the app from a checked-out release directory.

## SSH

- Host: `194.59.40.35`
- User: `platformaai`
- Primary command:

```bash
ssh -i ~/.ssh/platformaai_dokploy_ed25519 platformaai@194.59.40.35
```

- Public key fingerprint:

```text
SHA256:nZ52WI5eq9/KyYF6Lp2Q4VzeoW2TbMR+a57KbCGlAXs
```

- Public key:

```text
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIHdnPaNKV2JoID1+nTw/wez0XWzsAofajsoaVJPlB4z+ platformaai-dokploy-2026-04-14
```

## Runtime Paths

- Active release checkout for this branch work:
  - `/home/platformaai/releases/nikolay`
- Older app checkout still present on host:
  - `/home/platformaai/app`

Use the release checkout that matches the branch you are deploying.

## Runtime Shape

- Node.js app, not Docker Compose, not PM2, not systemd service
- App processes listen on:
  - `3000`
  - `3001`
- Public app URL:
  - `https://ai.aurmind.ru`

The production server currently starts the app from the working tree and keeps two Next.js processes running for the two ports above.

## Core Commands

Connect and switch to the release:

```bash
ssh -i ~/.ssh/platformaai_dokploy_ed25519 platformaai@194.59.40.35
cd /home/platformaai/releases/nikolay
```

Update code:

```bash
git fetch origin
git checkout nikolay
git pull --ff-only origin nikolay
```

Build and migrate:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run build
```

Run checks on the server:

```bash
npm run lint
npm test
E2E_BASE_URL=https://ai.aurmind.ru npm run test:e2e
```

Repository helper scripts also target the real server shape now:

```bash
bash ./scripts/server-lint.sh
bash ./scripts/server-test.sh
E2E_BASE_URL=https://ai.aurmind.ru bash ./scripts/server-e2e.sh
bash ./scripts/server-check.sh
```

## Restart Flow

Find listeners:

```bash
ss -ltnp | grep -E ':3000|:3001'
```

Stop the current listeners and start fresh processes:

```bash
kill <pid-on-3000> <pid-on-3001>
PORT=3000 nohup npm run start > app-3000.log 2>&1 &
PORT=3001 nohup npm run start > app-3001.log 2>&1 &
```

Verify listeners came back:

```bash
ss -ltnp | grep -E ':3000|:3001'
```

## Smoke Checks

Local on host:

```bash
curl -fsS http://127.0.0.1:3000/api/internal/health
curl -fsS http://127.0.0.1:3000/api/internal/readiness
curl -I http://127.0.0.1:3000/login?mode=signin
curl -I http://127.0.0.1:3000/pricing
```

Public:

```bash
curl -fsS https://ai.aurmind.ru/api/internal/health
curl -I https://ai.aurmind.ru/login?mode=signin
curl -I https://ai.aurmind.ru/pricing
```

## Important Caveats

- Do not assume Docker is available on the host for deploy or test commands.
- Do not assume `rg` is installed on the host.
- `prisma/seed.ts` is intentionally blocked in production; do not run `npm run prisma:seed` on the server.
- If Prisma reports a previously failed migration that is already reflected in the schema, inspect `_prisma_migrations` and resolve carefully before rerunning `prisma migrate deploy`.
