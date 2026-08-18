# tu-seguridad-back

Backend for "person detection in restricted zones" system. 8 home cameras behind DVR/NVR. Owns camera/zone config (MySQL), detection-pipeline orchestration, zone evaluation (point-in-polygon + hysteresis), technical events, live event push to frontend over WebSocket. Person detection delegated to external upstream API ([face-auth](#face-auth-upstream-contract)) — backend sends snapshots, gets back bounding boxes + precomputed foot-point anchor.

Engineering rules are central, consumed as a submodule at [`.standards/`](.standards/README.md) (`git submodule update --init` in a fresh clone or worktree). This repo's own facts, standards map, and declared overrides: [`AGENTS.md`](AGENTS.md). Full architecture + task-by-task plan: [`plans/01.setup.md`](plans/01.setup.md). Live status of every task: [`plans/01.setup.tasks.md`](plans/01.setup.tasks.md). Design decisions: [`ARCHITECTURE.md`](ARCHITECTURE.md). Tooling/ops gotchas: [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).

## Status

All 25 setup-plan tasks done — see [`plans/01.setup.tasks.md`](plans/01.setup.tasks.md) for task-by-task record (what built, how verified, any deviations). Second plan, [`02.infra-hardening`](plans/02.infra-hardening.md), in progress: dependency scanning, face-auth circuit breaker, Sentry error tracking, deeper health checks + graceful shutdown, OpenAPI contract artifact all **merged** (see [Observability, resilience & supply chain](#observability-resilience--supply-chain)); Prometheus metrics, deploy pipeline, `snapshotUrl` encryption + `sops` secrets still open — live status in [`plans/02.infra-hardening.tasks.md`](plans/02.infra-hardening.tasks.md). Out-of-scope-for-now items (per-track events, alerting, notifications) under [Roadmap](#roadmap).

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node 22 LTS (`.nvmrc`), npm |
| Framework | NestJS 11 + Express, TypeScript strict |
| API docs | `@nestjs/swagger` (UI at `/docs`, bearer auth) |
| Validation | `class-validator`/`class-transformer`, global `ValidationPipe` |
| Config | `@nestjs/config` + Joi env schema, fail-fast |
| Auth | `@nestjs/jwt` (access + refresh), users in MySQL, bcrypt |
| Rate limiting | `@nestjs/throttler`, global guard, production only |
| Security | helmet, CORS allowlist, cookie-parser, compression |
| Health | `@nestjs/terminus` — `/health/live`, `/health/ready` (DB ping), `/health/dependencies` (face-auth reachability) |
| Logging | `nestjs-pino`, structured JSON, request id, redaction |
| Tracing | OpenTelemetry, opt-in via `OTEL_ENABLED`, `withSpan` helper |
| Error tracking | `@sentry/node`, opt-in via `SENTRY_DSN`, unexpected 500s only, secrets scrubbed |
| Resilience | `opossum` circuit breaker around face-auth upstream (in-memory, no infra) |
| API contract | committed `openapi.json`, exported by `scripts/export-openapi.ts`, diff-checked in CI |
| Supply chain | `npm audit` gate (prod deps, critical) + Dependabot (weekly, targets `develop`) |
| ORM | Prisma + `@prisma/client`, MySQL, migrations + seed |
| Outbound HTTP | `@nestjs/axios` (face-auth client, DVR snapshot fetch) |
| Scheduling | `@nestjs/schedule` (per-camera DVR polling) |
| WebSockets | `@nestjs/websockets` + socket.io, namespace `/events` |
| Tests | Jest — unit / integration / e2e (see [Testing](#testing)) |
| Git hooks | husky + lint-staged + commitlint (Conventional Commits) |
| Prod | PM2 (`ecosystem.config.js`), fork mode, graceful shutdown |

## Quickstart

```bash
nvm use                          # Node 22, see .nvmrc
npm ci
cp .env.example .env             # fill real MySQL creds + face-auth tenant/token
# MySQL runs in docker in this dev setup (container mysql-local, port 3306) —
# start it before anything DB-related. `docker ps`, not `systemctl`.
npx prisma generate
npx prisma migrate deploy        # applies migrations against DATABASE_URL
# create + migrate the test DB too (see the Environment variables table below
# for DATABASE_URL_TEST), then: DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy
npm run prisma:seed              # idempotent, upserts admin from ADMIN_EMAIL/ADMIN_PASSWORD
npm run start:dev
```

Then: `curl http://localhost:3000/docs` for Swagger UI, or `POST /api/v1/auth/login` with seeded admin credentials → token.

## npm scripts

Which of these map to the canonical check names (`format`, `lint`, `typecheck`, `test`, `build`, `security`), and which are still missing: [`AGENTS.md`](AGENTS.md) → *Checks*.

| Script | What it does |
|---|---|
| `start` / `start:dev` / `start:debug` | Run app: plain, watch mode, watch mode + inspector on `0.0.0.0:9229`. |
| `start:prod` | Run compiled app (`node dist/src/main`) — what PM2 runs. |
| `build` | `nest build` → `dist/`. |
| `lint` | ESLint (`--fix`) over `src`, `test`. |
| `format` | Prettier `--write` over `src`, `test`. |
| `test` | Unit tests (`*.spec.ts`), no DB, no network. |
| `test:int` | Integration tests (`*.int-spec.ts`), hits real `DATABASE_URL_TEST` MySQL DB. |
| `test:e2e` | Full app boot (HTTP + WebSocket + test DB), face-auth client faked. |
| `test:all` | All three levels in sequence — what CI runs. |
| `test:cov` | Unit coverage; enforces 80%-lines floor. |
| `test:debug` | Attach debugger to currently-running Jest process. |
| `prisma:generate` / `:migrate` / `:deploy` / `:seed` / `:studio` | Prisma CLI shortcuts. |
| `openapi:export` | Regenerate committed `openapi.json` from live API surface (no DB/network). Run after any DTO/route change — CI fails if committed file stale. |
| `pm2:start` / `:stop` / `:logs` | `pm2 start ecosystem.config.js --env production` / stop / tail logs. |

## API surface

Everything prefixed `/api/v1` (global prefix `api` + URI versioning) except `/docs*` and `/health/*` — version-neutral, unprefixed. Everything needs bearer JWT except login, refresh, logout, health, docs.

| Method & path | Notes |
|---|---|
| `POST /api/v1/auth/login` | Public. Email+password → `{accessToken}` in the body; refresh token set as an `httpOnly`, path-scoped cookie, never returned in the body. |
| `POST /api/v1/auth/refresh` | Public. Reads the refresh cookie — no body fallback — rotates the pair and re-sets the cookie. |
| `POST /api/v1/auth/logout` | Public. Clears the refresh cookie, 204. |
| `GET /api/v1/auth/me` | Bearer. Current user from the access-token payload. |
| `GET/POST /api/v1/cameras`, `GET/PUT/DELETE /api/v1/cameras/:id` | CRUD. List masks `snapshotUrl` as `"***"`; detail returns full. |
| `GET /api/v1/cameras/:id/status` | Pipeline status: last poll/success/error, latency, occupancy per zone. |
| `POST /api/v1/cameras/:id/analyze` | Multipart `file` upload (max 10MB): runs full detection pipeline synchronously on image — manual-test path when DVR unreachable. |
| `GET/POST /api/v1/cameras/:id/zones` | List / create zones for camera. |
| `GET/PUT/DELETE /api/v1/zones/:id` | `PUT` bumps `geometryVersion` only when polygon changes. |
| `POST /api/v1/zones/:id/validate` | Dry-run polygon validation → `{valid, violations[]}`, **always** 200. |
| `GET /api/v1/events` | Filters: `cameraId`, `zoneId`, `eventType`, `from`, `to`, `limit` (default 100, silently clamped to 1000). |
| `GET /health/live`, `GET /health/ready` | Public. `ready` pings DB via Terminus. |
| `GET /health/dependencies` | Public. Separate from `ready`: short-timeout reachability check against face-auth upstream. Degraded upstream reports here **without** marking whole app not-ready (camera/zone CRUD still works). |
| WS namespace `/events` | JWT in handshake `auth.token`; server emits `zone-event` on every persisted event. Clients disconnected cleanly on graceful shutdown. |

Full interactive docs: `GET /docs` (Swagger UI), machine-readable spec at `/docs-json`.

## Auth model

JWT access + refresh, both signed with distinct secrets and TTLs (`JWT_SECRET`/`JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`/`JWT_REFRESH_EXPIRES_IN`). The refresh token travels **only** as an `httpOnly`, path-scoped cookie (`secure` in production), with `maxAge` derived from the token's own `exp` — never in a response body, and `/auth/refresh` accepts no body fallback. Global `JwtAuthGuard` protects every route by default; `@Public()` opts route out (login, refresh, logout, health, docs, scaffold root route). `@CurrentUser()` reads JWT payload attached to request. Cross-token misuse rejected both directions — refresh token used as bearer access token fails signature verification (different secret) plus explicit `type` check; access token presented to `/auth/refresh` fails same `type` check other way.

## face-auth upstream contract

`FaceAuthClientService` (`src/modules/face-auth-client/`) POSTs camera snapshot as `multipart/form-data` to `{FACE_AUTH_API_URL}/api/v1/persons` with `Fa-Domain`/`Fa-Token` headers → gets back:

```json
{
  "personsDetected": true,
  "imageWidth": 1280, "imageHeight": 720,
  "persons": [{
    "detScore": 0.91,
    "bbox": { "topLeft": {"x":417,"y":163}, "bottomRight": {"x":596,"y":682} },
    "bboxNorm": { "topLeft": {"x":0.32,"y":0.22}, "bottomRight": {"x":0.46,"y":0.94} },
    "anchor": { "x": 0.396, "y": 0.947 }
  }]
}
```

`anchor` already normalized foot point (bbox bottom-center) — used directly for point-in-polygon zone evaluation. Upstream failures map to `UPSTREAM_TIMEOUT` or `UPSTREAM_ERROR` (upstream HTTP status in message, never `Fa-Token` value). Endpoint IP-throttled upstream — never poll faster than `pollingIntervalSeconds` per camera.

Call wrapped in [`opossum`](https://github.com/nodeshift/opossum) **circuit breaker** (in-memory, one shared breaker per process — upstream is single tenant). Past failure threshold (50% over rolling window, `resetTimeout` 30s) breaker opens → short-circuits to `UPSTREAM_ERROR 'face-auth circuit open'` **without** attempting call — down/throttled upstream stops eating full `DETECT_TIMEOUT_MS` waits, stops being hammered. Single probe allowed after reset (half-open). Open/half-open/close transitions logged; current state readable via `FaceAuthClientService.circuitState`.

## Detection pipeline

`PipelineService.processImage` (`src/modules/pipeline/`) — single place full loop runs, whether triggered automatically or manually:

1. `SnapshotService` fetches DVR image (or uploaded file, for `/analyze`).
2. `FaceAuthClientService.detectPersons` gets bounding boxes + anchors back.
3. Persons below camera's `confidenceThreshold` filtered out.
4. `OccupancyEngine.evaluate` (`src/modules/pipeline/occupancy.engine.ts`) runs point-in-polygon per enabled zone, applies **hysteresis**: zone fires `PERSON_ENTERED_ZONE` only after `ENTER_CONSECUTIVE_POLLS` consecutive polls with ≥1 anchor inside, `PERSON_EXITED_ZONE` after `EXIT_CONSECUTIVE_POLLS` consecutive misses. Single missed/extra poll (flicker) fires no event — miss/hit during pending transition resets streak to zero, not decrements it.
5. Each transition persisted (idempotent on `eventId`), broadcast over `/events` WebSocket namespace via `EventsService.emit`.
6. `CameraStatusRegistry` records outcome (`lastPolledAt`, `lastSuccessAt`, `lastErrorCode`, `lastLatencyMs`, `lastPersonsDetected`, per-zone occupancy) — surfaced at `GET /cameras/:id/status`.

`PollingScheduler` drives step 1–6 automatically on per-camera interval when `POLLING_ENABLED=true` (off by default in dev). Skips a tick if previous one for that camera still in flight (counted, not silently dropped), re-syncs registered intervals every 30s to pick up camera CRUD changes. `POST /cameras/:id/analyze` runs same `processImage` synchronously against uploaded image — manual path when DVR itself unreachable, or for testing without waiting on poll cadence.

## Observability, resilience & supply chain

Infra concerns handled by frameworks below. **Every external integration is opt-in and no-ops cleanly when its env var is unset** — same posture as `OTEL_ENABLED`. Local dev never depends on running external service; production turns each on via env.

| Concern | Framework / tool | Where | How it's wired |
|---|---|---|---|
| Structured logging | `nestjs-pino` + `pino-http` | `src/cross/config/logger.options.ts` | JSON logs, per-request id, `snapshotUrl`/`Authorization`/`Fa-Token` redaction. Always on. |
| Tracing | OpenTelemetry SDK | `src/observability/tracing.ts`, `tracing.helpers.ts` | Opt-in via `OTEL_ENABLED`. Loaded **before** `ConfigModule` (reads `dotenv` itself). `withSpan(name, attrs, fn)` wraps spans; no-op when disabled. |
| Error tracking | `@sentry/node` | `src/observability/sentry.ts`, `main.ts`, `either.interceptor.ts` | Opt-in via `SENTRY_DSN`. `initSentry()` runs before `NestFactory.create`. `Sentry.captureException` fires **only** on interceptor's unexpected-500 branch — never for `Either` failures or mapped `HttpException` (no routine 4xx noise). `beforeSend`/`beforeBreadcrumb` scrub `snapshotUrl` + auth headers. Unset DSN = zero network activity. |
| Resilience | `opossum` circuit breaker | `src/modules/face-auth-client/face-auth-client.service.ts` | See [face-auth contract](#face-auth-upstream-contract). In-memory, no infra dependency. |
| Health | `@nestjs/terminus` | `src/modules/health/` | `/health/live` (process), `/health/ready` (DB ping — LB readiness), `/health/dependencies` (face-auth reachability, **separate** so degraded upstream never marks app not-ready). All `@Public()`, version-neutral. |
| Graceful shutdown | Nest lifecycle hooks | `events.gateway.ts`, `polling.scheduler.ts`, `prisma.service.ts` | On `SIGINT`/`SIGTERM` (`enableShutdownHooks()`): scheduler stops issuing new poll ticks, WS server disconnects clients cleanly **before** Prisma disconnects — Nest's reverse teardown order (feature modules before shared `DataModule`) guarantees it. In-flight polls left to finish, not killed. |
| API contract | `@nestjs/swagger` + a committed artifact | `scripts/export-openapi.ts`, `openapi.json` | `openapi.json` — diffable, version-controlled artifact. CI regenerates it, fails on drift — run `npm run openapi:export` and commit after any DTO/route change. Live UI still at `/docs`, raw at `/docs-json`. |
| Supply chain | `npm audit` + Dependabot | `.github/workflows/pr-tests.yml`, `.github/dependabot.yml` | CI gate `npm audit --omit=dev --audit-level=critical` blocks only production-dependency **critical** vulnerabilities (dev tooling doesn't ship; high transitive advisories churn constantly). Dependabot opens weekly grouped update PRs against `develop` for the rest. |

> **In flight** (open PRs, tracked in [`plans/02.infra-hardening.md`](plans/02.infra-hardening.md), not yet on `develop`): Prometheus `/metrics` (T04), SSH/PM2 deploy pipeline (T02), `snapshotUrl` field encryption at rest + `sops`/`age` secrets (T06). Check [`plans/02.infra-hardening.tasks.md`](plans/02.infra-hardening.tasks.md) for live status before assuming any present.

## Testing

Three levels, matching plan's convention:

| Level | Suffix | Command | What it needs |
|---|---|---|---|
| Unit | `*.spec.ts` | `npm test` | Nothing — no DB, no network. |
| Integration | `*.int-spec.ts` | `npm run test:int` | Real local MySQL, `DATABASE_URL_TEST`. Truncates tables — **never** point it at the dev database. |
| E2E | `*.e2e-spec.ts` | `npm run test:e2e` | Same test DB; boots real app (HTTP + WebSocket); `FaceAuthClientService` replaced by fake — no real upstream calls. |

`npm run test:all` runs all three in sequence (what CI does). `npm run test:cov` runs unit coverage with enforced 80%-lines floor (`*.module.ts`/`*.dto.ts`/test files themselves excluded from coverage denominator — boilerplate, no branching logic).

## Debugging

`npm run start:debug` starts app with inspector bound to `0.0.0.0:9229` (also visible as `Debugger listening on ws://0.0.0.0:9229/<uuid>` in log). `.vscode/launch.json` has two configs: **Attach to API** (attach to that port, source maps on) and **Debug Jest current file** (launches Jest against whichever file open in editor, `--runInBand`).

## PM2 (production)

```bash
npm run build
npm run pm2:start   # pm2 start ecosystem.config.js --env production
npm run pm2:logs
npm run pm2:stop
```

`ecosystem.config.js` runs in **fork** mode, never cluster — socket.io connections and in-memory occupancy/status state don't survive being split across worker processes. Autorestart on, capped at 10 restarts, 512M memory ceiling, 3s restart delay. On `SIGINT`/`SIGTERM` shutdown ordered (see [Graceful shutdown](#observability-resilience--supply-chain)): polling scheduler stops (`polling scheduler stopped, no new ticks will start`), WS clients get clean `disconnect`, **then** Prisma disconnects (`Shutting down gracefully, disconnecting Prisma`), before PM2 restarts process. Note: `pm2 reload` in fork mode with `instances: 1` is fast restart, not zero-downtime swap — acceptable at current scale.

## Environment variables

All validated by Joi in `src/cross/config/env-validation.schema.ts` (`.env.example` — canonical list, copy to `.env` and fill real values; never commit `.env`).

| Var | Default (dev) | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development \| test \| production`. |
| `PORT` | `3000` | |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowlist. |
| `LOG_LEVEL` | `info` | pino level. |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | — / `15m` | Access token. Required in production. |
| `JWT_REFRESH_SECRET` / `JWT_REFRESH_EXPIRES_IN` | — / `7d` | Refresh token, distinct secret. Required in production. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Only used by `prisma:seed` (bcrypt-hashed). `ADMIN_PASSWORD` is required in production and must be at least 16 characters — the seeded admin owns the space and holds the `admin` membership. |
| `DATABASE_URL` | — | Primary MySQL connection. Required in production. |
| `DATABASE_URL_TEST` | — | Test DB — used by `test:int`/`test:e2e`, never dev DB. |
| `SHADOW_DATABASE_URL` | — | Optional; Prisma's shadow DB for `migrate dev`. Not in original plan spec, added when needed. |
| `FACE_AUTH_API_URL` / `FACE_AUTH_DOMAIN` / `FACE_AUTH_TOKEN` | — | Upstream face-auth tenant. Required in production. |
| `DETECT_TIMEOUT_MS` | `10000` | face-auth request timeout. |
| `POLLING_ENABLED` | `false` | Master switch for DVR polling scheduler. |
| `SNAPSHOT_TIMEOUT_MS` | `5000` | DVR snapshot fetch timeout. |
| `ENTER_CONSECUTIVE_POLLS` / `EXIT_CONSECUTIVE_POLLS` | `2` / `3` | Occupancy hysteresis thresholds. |
| `THROTTLE_TTL_SECONDS` / `THROTTLE_LIMIT` | `1` / `10` | Inbound rate limit — production only. |
| `OTEL_ENABLED` | `false` | Opt-in OpenTelemetry tracing. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP HTTP collector. |
| `OTEL_SERVICE_NAME` | `tu-seguridad-back` | Reported service name. |
| `SENTRY_DSN` | — | Opt-in error tracking. Unset = disabled (no network activity). Only unexpected 500s reported; secrets scrubbed. |

## Docs map

| File | What's in it |
|---|---|
| [`plans/01.setup.md`](plans/01.setup.md) | Full 25-task setup plan: domain model, API surface, env vars, per-task DoD. |
| [`plans/01.setup.tasks.md`](plans/01.setup.tasks.md) | Live status per task, how each verified. |
| [`plans/02.infra-hardening.md`](plans/02.infra-hardening.md) | Infra plan: CD, resilience, observability, security. Per-task DoD. |
| [`plans/02.infra-hardening.tasks.md`](plans/02.infra-hardening.tasks.md) | Live status + deviations for infra tasks (merged vs open). |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Decisions behind the layering: accessor conventions, resilience/observability choices, deviations from plan. |
| [`AGENTS.md`](AGENTS.md) | Project facts, git identity, `Applicable standards` map, check commands, repo-specific rules, declared overrides. Read this before the central standards. |
| [`.standards/`](.standards/README.md) | Central engineering standards, consumed as a submodule. Read order, precedence, per-stack rules. Never edited from here. |
| [`docs/STANDARDS_GAPS.md`](docs/STANDARDS_GAPS.md) | Where this repo does not meet the central standards yet, and the fix for each. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Pointers into the central workflow + what this repo's CI actually runs. |
| [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md) | Tooling/ops gotchas learned building this repo. |
| [`CLAUDE.md`](CLAUDE.md) | Claude Code specific notes on top of `AGENTS.md`. |

## Roadmap

- **02 — infra hardening** ([`plans/02.infra-hardening.md`](plans/02.infra-hardening.md), in progress): CD pipeline, circuit breaker, Prometheus metrics, Sentry, dependency scanning, secrets + `snapshotUrl` encryption, deeper health checks + graceful shutdown, OpenAPI contract. **Deferred** in that plan: Docker, anything Redis-dependent (distributed throttler storage, cache, socket.io adapter, BullMQ) — cost-prohibitive at current scale.
- **03** — Per-track events (`track_id`) once face-auth exposes tracking; `PERSON_UPDATED_IN_ZONE`; movement-vs-presence rules.
- **04** — Business layer: alert rules, schedules, notifications, clip/snapshot storage, authorization of known persons.
- DVR snapshot reliability (retries, backoff, reconnection metrics), per-camera FPS tuning.
