# tu-seguridad-back

Backend for person-detection-in-restricted-zones system. 8 home cameras behind DVR/NVR. This backend owns camera/zone config (MySQL), pipeline orchestration, zone evaluation (point-in-polygon + hysteresis), technical events, live push to frontend. Person detection delegated to external face-auth API.

Full architecture + task-by-task plan: [`plans/01.setup.md`](plans/01.setup.md). Live status of every task: [`plans/01.setup.tasks.md`](plans/01.setup.tasks.md). Check those before trusting anything below as final — README tracks what exists NOW, plan tracks what's coming.

## Stack (so far)

Node 22, NestJS 11 + Express, TypeScript strict, Prisma + MySQL, class-validator, `@nestjs/config` + Joi, `@nestjs/throttler`, helmet + nestjs-pino, `@nestjs/swagger`. Full table: `plans/01.setup.md` §2.

## Quickstart

```bash
nvm use                          # Node 22, see .nvmrc
npm ci
cp .env.example .env              # fill real MySQL creds + face-auth tenant/token
# MySQL runs in docker (container mysql-local in this dev setup) — start it before anything DB-related
npx prisma generate
npx prisma migrate deploy         # against DATABASE_URL
# create + migrate test DB too (see plans/01.setup.md §6 for DATABASE_URL_TEST)
npm run prisma:seed               # idempotent, upserts admin from ADMIN_EMAIL/ADMIN_PASSWORD
npm run start:dev
```

Gotcha: MySQL here runs as **docker container**, not systemd service — `systemctl start mysql` finds nothing. Check `docker ps` for `mysql-local`-style container instead. Details: [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Test levels

- `npm test` — unit, `*.spec.ts`, no DB.
- `npm run test:int` — integration, `*.int-spec.ts`, hits REAL local test DB (`DATABASE_URL_TEST`). Truncates tables — never point at dev DB.
- `npm run test:e2e` — full app boot, coming in T19.

## Docs map

| File | What's in it |
|---|---|
| [`plans/01.setup.md`](plans/01.setup.md) | full 25-task setup plan, domain model, API surface, env vars |
| [`plans/01.setup.tasks.md`](plans/01.setup.tasks.md) | live status per task — check here first for "what's done" |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | layering rules, Either pattern, accessor conventions, deviations from plan |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | branch model, PR flow, commit rules, git/gh setup gotchas |
| [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md) | tooling/ops gotchas learned building this repo — read before repeating a mistake |

## Status

Setup plan in progress. Schema + migrations + seed + data accessor layer done (T01-T08). Auth, cameras, zones, events, pipeline, tests, CI still ahead. See [`plans/01.setup.tasks.md`](plans/01.setup.tasks.md) for exact state.
