# tu-seguridad-back

Backend for the "person detection in restricted zones" system. 8 home cameras behind a DVR/NVR. This service owns camera/zone configuration (MySQL), detection-pipeline orchestration, zone evaluation (point-in-polygon + hysteresis), technical events, and live event push to the frontend over WebSocket. Person detection itself is delegated to an external upstream API ([face-auth](#face-auth-upstream-contract)) — this backend sends snapshots and gets back bounding boxes + a precomputed foot-point anchor.

Full architecture + task-by-task plan: [`plans/01.setup.md`](plans/01.setup.md). Live status of every task: [`plans/01.setup.tasks.md`](plans/01.setup.tasks.md). Conventions and layering rules: [`ARCHITECTURE.md`](ARCHITECTURE.md). Branch model, PR flow, git/gh setup: [`CONTRIBUTING.md`](CONTRIBUTING.md). Tooling/ops gotchas: [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).

## Status

All 25 setup-plan tasks are done — see [`plans/01.setup.tasks.md`](plans/01.setup.tasks.md) for the task-by-task record (what was built, how it was verified, and any deviations). Out-of-scope-for-now items (per-track events, alerting, notifications) are listed under [Roadmap](#roadmap).

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
| Health | `@nestjs/terminus` — `/health/live`, `/health/ready` (DB ping) |
| Logging | `nestjs-pino`, structured JSON, request id, redaction |
| Tracing | OpenTelemetry, opt-in via `OTEL_ENABLED`, `withSpan` helper |
| ORM | Prisma + `@prisma/client`, MySQL, migrations + seed |
| Outbound HTTP | `@nestjs/axios` (face-auth client, DVR snapshot fetch) |
| Scheduling | `@nestjs/schedule` (per-camera DVR polling) |
| WebSockets | `@nestjs/websockets` + socket.io, namespace `/events` |
| Tests | Jest — unit / integration / e2e (see [Testing](#testing)) |
| Git hooks | husky + lint-staged + commitlint (Conventional Commits) |
| Prod | PM2 (`ecosystem.config.js`), fork mode |

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

Then: `curl http://localhost:3000/docs` for the Swagger UI, or `POST /api/v1/auth/login` with the seeded admin credentials to get a token.

## npm scripts

| Script | What it does |
|---|---|
| `start` / `start:dev` / `start:debug` | Run the app: plain, watch mode, watch mode + inspector on `0.0.0.0:9229`. |
| `start:prod` | Run the compiled app (`node dist/src/main`) — what PM2 actually runs. |
| `build` | `nest build` → `dist/`. |
| `lint` | ESLint (`--fix`) over `src`, `test`. |
| `format` | Prettier `--write` over `src`, `test`. |
| `test` | Unit tests (`*.spec.ts`), no DB, no network. |
| `test:int` | Integration tests (`*.int-spec.ts`), hits the real `DATABASE_URL_TEST` MySQL database. |
| `test:e2e` | Full app boot (HTTP + WebSocket + test DB), face-auth client faked. |
| `test:all` | All three levels in sequence — what CI runs. |
| `test:cov` | Unit coverage; enforces an 80%-lines floor. |
| `test:debug` | Attach a debugger to the currently-running Jest process. |
| `prisma:generate` / `:migrate` / `:deploy` / `:seed` / `:studio` | Prisma CLI shortcuts. |
| `pm2:start` / `:stop` / `:logs` | `pm2 start ecosystem.config.js --env production` / stop / tail logs. |

## API surface

Everything is prefixed `/api/v1` (global prefix `api` + URI versioning) except `/docs*` and `/health/*`, which are version-neutral and unprefixed. Everything requires a bearer JWT except login, refresh, health, and docs.

| Method & path | Notes |
|---|---|
| `POST /api/v1/auth/login` | Public. Email+password → `{accessToken, refreshToken}`. |
| `POST /api/v1/auth/refresh` | Public. Rotates the token pair. |
| `GET/POST /api/v1/cameras`, `GET/PUT/DELETE /api/v1/cameras/:id` | CRUD. List masks `snapshotUrl` as `"***"`; detail returns it in full. |
| `GET /api/v1/cameras/:id/status` | Pipeline status: last poll/success/error, latency, occupancy per zone. |
| `POST /api/v1/cameras/:id/analyze` | Multipart `file` upload (max 10MB): runs the full detection pipeline synchronously on the image — the manual-test path when the DVR is unreachable. |
| `GET/POST /api/v1/cameras/:id/zones` | List / create zones for a camera. |
| `GET/PUT/DELETE /api/v1/zones/:id` | `PUT` bumps `geometryVersion` only when the polygon actually changes. |
| `POST /api/v1/zones/:id/validate` | Dry-run polygon validation → `{valid, violations[]}`, **always** 200. |
| `GET /api/v1/events` | Filters: `cameraId`, `zoneId`, `eventType`, `from`, `to`, `limit` (default 100, silently clamped to 1000). |
| `GET /health/live`, `GET /health/ready` | Public. `ready` pings the database via Terminus. |
| WS namespace `/events` | JWT in handshake `auth.token`; server emits `zone-event` on every persisted event. |

Full interactive docs: `GET /docs` (Swagger UI), machine-readable spec at `/docs-json`.

## Auth model

JWT access + refresh, both signed with distinct secrets and TTLs (`JWT_SECRET`/`JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`/`JWT_REFRESH_EXPIRES_IN`). A global `JwtAuthGuard` protects every route by default; `@Public()` opts a route out (login, refresh, health, docs, the scaffold root route). `@CurrentUser()` reads the JWT payload attached to the request. Cross-token misuse is rejected both directions — a refresh token used as a bearer access token fails signature verification (different secret) plus an explicit `type` check; an access token presented to `/auth/refresh` fails the same `type` check the other way.

## face-auth upstream contract

`FaceAuthClientService` (`src/modules/face-auth-client/`) POSTs a camera snapshot as `multipart/form-data` to `{FACE_AUTH_API_URL}/api/v1/persons` with `Fa-Domain`/`Fa-Token` headers, and gets back:

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

`anchor` is already the normalized foot point (bbox bottom-center) — used directly for point-in-polygon zone evaluation. Upstream failures map to `UPSTREAM_TIMEOUT` or `UPSTREAM_ERROR` (with the upstream HTTP status in the message, never the `Fa-Token` value). The endpoint is IP-throttled upstream — never poll faster than `pollingIntervalSeconds` per camera.

## Detection pipeline

`PipelineService.processImage` (`src/modules/pipeline/`) is the single place the full loop runs, whether triggered automatically or manually:

1. `SnapshotService` fetches the DVR image (or the uploaded file, for `/analyze`).
2. `FaceAuthClientService.detectPersons` gets bounding boxes + anchors back.
3. Persons below the camera's `confidenceThreshold` are filtered out.
4. `OccupancyEngine.evaluate` (`src/modules/pipeline/occupancy.engine.ts`) runs point-in-polygon per enabled zone and applies **hysteresis**: a zone only fires `PERSON_ENTERED_ZONE` after `ENTER_CONSECUTIVE_POLLS` consecutive polls with ≥1 anchor inside, and `PERSON_EXITED_ZONE` after `EXIT_CONSECUTIVE_POLLS` consecutive misses. A single missed/extra poll (flicker) does not fire an event — a miss/hit during a pending transition resets that streak to zero rather than decrementing it.
5. Each transition is persisted (idempotent on `eventId`) and broadcast over the `/events` WebSocket namespace via `EventsService.emit`.
6. `CameraStatusRegistry` records the outcome (`lastPolledAt`, `lastSuccessAt`, `lastErrorCode`, `lastLatencyMs`, `lastPersonsDetected`, per-zone occupancy) — surfaced at `GET /cameras/:id/status`.

`PollingScheduler` drives step 1–6 automatically on a per-camera interval when `POLLING_ENABLED=true` (off by default in dev). It skips a tick if the previous one for that camera is still in flight (counted, not silently dropped) and re-syncs its registered intervals every 30s to pick up camera CRUD changes. `POST /cameras/:id/analyze` runs the exact same `processImage` synchronously against an uploaded image — the manual path for when the DVR itself isn't reachable, or for testing without waiting on the poll cadence.

## Testing

Three levels, matching the plan's convention:

| Level | Suffix | Command | What it needs |
|---|---|---|---|
| Unit | `*.spec.ts` | `npm test` | Nothing — no DB, no network. |
| Integration | `*.int-spec.ts` | `npm run test:int` | Real local MySQL, `DATABASE_URL_TEST`. Truncates tables — **never** point it at the dev database. |
| E2E | `*.e2e-spec.ts` | `npm run test:e2e` | Same test DB; boots the real app (HTTP + WebSocket); `FaceAuthClientService` replaced by a fake — no real upstream calls. |

`npm run test:all` runs all three in sequence (what CI does). `npm run test:cov` runs unit coverage with an enforced 80%-lines floor (`*.module.ts`/`*.dto.ts`/test files themselves are excluded from the coverage denominator — boilerplate with no branching logic).

## Debugging

`npm run start:debug` starts the app with the inspector bound to `0.0.0.0:9229` (also visible as `Debugger listening on ws://0.0.0.0:9229/<uuid>` in the log). `.vscode/launch.json` has two configs: **Attach to API** (attach to that port, source maps on) and **Debug Jest current file** (launches Jest against whichever file is open in the editor, `--runInBand`).

## PM2 (production)

```bash
npm run build
npm run pm2:start   # pm2 start ecosystem.config.js --env production
npm run pm2:logs
npm run pm2:stop
```

`ecosystem.config.js` runs in **fork** mode, never cluster — socket.io connections and the in-memory occupancy/status state don't survive being split across worker processes. Autorestart is on, capped at 10 restarts, with a 512M memory ceiling and a 3s restart delay. A graceful `SIGINT`/`SIGTERM` logs `Shutting down gracefully, disconnecting Prisma` before PM2 restarts the process.

## Environment variables

All validated by Joi in `src/cross/config/env-validation.schema.ts` (`.env.example` is the canonical list — copy it to `.env` and fill real values; never commit `.env`).

| Var | Default (dev) | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development \| test \| production`. |
| `PORT` | `3000` | |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowlist. |
| `LOG_LEVEL` | `info` | pino level. |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | — / `15m` | Access token. Required in production. |
| `JWT_REFRESH_SECRET` / `JWT_REFRESH_EXPIRES_IN` | — / `7d` | Refresh token, distinct secret. Required in production. |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | — | Only used by `prisma:seed` (bcrypt-hashed). |
| `DATABASE_URL` | — | Primary MySQL connection. Required in production. |
| `DATABASE_URL_TEST` | — | Test DB — used by `test:int`/`test:e2e`, never the dev DB. |
| `SHADOW_DATABASE_URL` | — | Optional; Prisma's shadow DB for `migrate dev`. Not in the original plan spec, added when it was needed. |
| `FACE_AUTH_API_URL` / `FACE_AUTH_DOMAIN` / `FACE_AUTH_TOKEN` | — | Upstream face-auth tenant. Required in production. |
| `DETECT_TIMEOUT_MS` | `10000` | face-auth request timeout. |
| `SNAPSHOT_URL_ENCRYPTION_KEY` | dev default | 32-byte AES-256-GCM key (64 hex chars or base64) for `snapshotUrl` encryption at rest. Required in production, fails fast at boot if missing/malformed. |
| `POLLING_ENABLED` | `false` | Master switch for the DVR polling scheduler. |
| `SNAPSHOT_TIMEOUT_MS` | `5000` | DVR snapshot fetch timeout. |
| `ENTER_CONSECUTIVE_POLLS` / `EXIT_CONSECUTIVE_POLLS` | `2` / `3` | Occupancy hysteresis thresholds. |
| `THROTTLE_TTL_SECONDS` / `THROTTLE_LIMIT` | `1` / `10` | Inbound rate limit — production only. |
| `OTEL_ENABLED` | `false` | Opt-in OpenTelemetry tracing. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP HTTP collector. |
| `OTEL_SERVICE_NAME` | `tu-seguridad-back` | Reported service name. |
| `SENTRY_DSN` | — | Opt-in error tracking. Unset = disabled (no network activity). Only unexpected 500s are reported; secrets are scrubbed. |
| `METRICS_TOKEN` | — | Shared secret for `GET /metrics` (`X-Metrics-Token` header). Required in production; unset in dev leaves `/metrics` open. |

## Docs map

| File | What's in it |
|---|---|
| [`plans/01.setup.md`](plans/01.setup.md) | The full 25-task setup plan: domain model, API surface, env vars, per-task DoD. |
| [`plans/01.setup.tasks.md`](plans/01.setup.tasks.md) | Live status per task, with how each one was actually verified. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Layering rules, Either pattern, accessor conventions, deviations from the plan. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Branch model, PR flow, commit rules, git/gh setup gotchas. |
| [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md) | Tooling/ops gotchas learned building this repo. |
| [`CLAUDE.md`](CLAUDE.md) / [`AGENT.md`](AGENT.md) | Conventions for AI coding agents working in this repo. |

## Roadmap

Out of scope for this setup plan, left for future plans (see `plans/01.setup.md` §10):

- **02** — DVR snapshot reliability (retries, backoff, reconnection metrics), per-camera FPS tuning, camera status persistence.
- **03** — Per-track events (`track_id`) once face-auth exposes tracking; `PERSON_UPDATED_IN_ZONE`; movement-vs-presence rules.
- **04** — Business layer: alert rules, schedules, notifications, clip/snapshot storage, authorization of known persons.
- Deploy pipeline, nginx reverse proxy, throttler Redis storage (if ever multi-instance), snapshotUrl encryption at rest.
