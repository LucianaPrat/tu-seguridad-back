# tu-seguridad-back

Backend for "person detection in restricted zones" system. 8 home cameras behind DVR/NVR. Owns tenant/camera/zone config (MySQL), detection-pipeline orchestration, zone evaluation (percentage rectangles + hysteresis), alert history, live event push to frontend over WebSocket. Person detection delegated to external upstream API ([face-auth](#face-auth-upstream-contract)) — backend sends snapshots, gets back bounding boxes + precomputed foot-point anchor.

Engineering rules are central, consumed as a submodule at [`.standards/`](.standards/README.md) (`git submodule update --init` in a fresh clone or worktree). This repo's own facts, standards map, and declared overrides: [`AGENTS.md`](AGENTS.md). Work is driven by numbered plans under [`plans/`](plans/), executed in order, each with a companion tracker carrying live status — the current domain model comes from [`plans/03.tenant-alert-data-model.md`](plans/03.tenant-alert-data-model.md), not from the setup plan it superseded. Design decisions: [`ARCHITECTURE.md`](ARCHITECTURE.md). Tooling/ops gotchas: [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).

## Status

All 25 setup-plan tasks done — see [`plans/01.setup.tasks.md`](plans/01.setup.tasks.md) for task-by-task record (what built, how verified, any deviations). Second plan, [`02.infra-hardening`](plans/02.infra-hardening.md), in progress: dependency scanning, face-auth circuit breaker, Sentry error tracking, deeper health checks + graceful shutdown, OpenAPI contract artifact all **merged** (see [Observability, resilience & supply chain](#observability-resilience--supply-chain)); Prometheus metrics, deploy pipeline and `sops` secrets still open — live status in [`plans/02.infra-hardening.tasks.md`](plans/02.infra-hardening.tasks.md).

Third plan, [`03.tenant-alert-data-model`](plans/03.tenant-alert-data-model.md), **complete**: the setup-era single-admin camera/polygon-zone/zone-event schema is gone, replaced by the tenant model the frontend needs — a `Space` as tenant root, one DVR per space owning its discovered cameras, percentage-rectangle monitor zones, snapshot bytes in MySQL behind a space-scoped route, and alert history with per-channel delivery attempts. It was a deliberate breaking change to schema and API, safe only because production held no data. Task-by-task record: [`plans/03.tenant-alert-data-model.tasks.md`](plans/03.tenant-alert-data-model.tasks.md). What it deliberately did **not** ship — the notification provider itself, webhook authentication, snapshot retention, detection cooldown — is under [Roadmap](#roadmap).

## Stack

| Concern | Choice |
|---|---|
| Runtime | Node 22 LTS (`.nvmrc`), npm |
| Framework | NestJS 11 + Express, TypeScript strict |
| API docs | `@nestjs/swagger` (UI at `/docs`, bearer auth) |
| Validation | `class-validator`/`class-transformer`, global `ValidationPipe` |
| Config | `@nestjs/config` + Joi env schema, fail-fast |
| Auth | `@nestjs/jwt` access token + database-backed refresh (`auth_tokens`), bcrypt passwords, space + role claims |
| Secrets at rest | AES-256-GCM field encryption for the DVR password (`DVR_PASSWORD_ENCRYPTION_KEY`); every other credential stored as a purpose-separated hash |
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

Everything prefixed `/api/v1` (global prefix `api` + URI versioning) except `/docs*` and `/health/*` — version-neutral, unprefixed. Bearer JWT is the default; `@Public()` routes are the exception, and they are exactly the ones that cannot have a session yet or are called by something that is not a browser: login, register, refresh, logout, the password-reset and magic-link pairs, face login, invitation acceptance, the provider acknowledgement webhook, health, docs and the scaffold root route.

The tenant rule holds everywhere else: a request derives its `spaceId` from the caller's own membership claim, never from the path or the body, and every accessor puts it in the `where`. An id belonging to another space answers `404`, not `403` — the difference itself would confirm the row exists. Writes that change what the system watches (DVR, cameras, zones, invitations) are admin-only; members read.

The `03` plan replaced these shapes destructively rather than shipping a `/v2` beside them: the setup-era `/v1` had no consumer and no compatibility window was agreed, so a second version number would have pointed at nothing. See [`plans/03.tenant-alert-data-model.tasks.md`](plans/03.tenant-alert-data-model.tasks.md).

| Method & path | Notes |
|---|---|
| `POST /api/v1/auth/login` | Public. Email+password → `{accessToken}` in the body; refresh token set as an `httpOnly`, path-scoped cookie, never returned in the body. |
| `POST /api/v1/auth/refresh` | Public. Reads the refresh cookie — no body fallback — rotates the pair and re-sets the cookie. |
| `POST /api/v1/auth/logout` | Public. Clears the refresh cookie, 204. |
| `POST /api/v1/auth/register` | Public. Creates the account, its space, and the owner `admin` membership in one transaction, then opens a session. 201. |
| `GET /api/v1/auth/me` | Bearer. Current user from the access-token payload: space id, membership role, `profileCompleted`, active state. Reachable with an incomplete profile. |
| `POST /api/v1/auth/complete-profile` | Bearer. The only other route an incomplete profile can reach — sets name, phone and a real password, then lifts the gate. |
| `POST /api/v1/auth/password-reset/request` | Public. Always `202 {accepted:true}`, registered address or not — the answer must not enumerate accounts. Token delivered out of band. |
| `POST /api/v1/auth/password-reset/confirm` | Public. Consumes the token, sets the new password. Single use. |
| `POST /api/v1/auth/magic-link/request` | Public. Same `202` shape and same non-enumeration rule as the reset request. |
| `POST /api/v1/auth/magic-link/consume` | Public. Consumes the token and opens a session — access token in the body, refresh only as the cookie. |
| `POST /api/v1/auth/face/identities` | Bearer. Enrolls a face-provider identity, storing only its hash. Re-enrolling revokes the previous active identity rather than overwriting it. 201. |
| `POST /api/v1/auth/face/login` | Public. Looks the presented provider token up by hash; only an active identity authenticates. |
| `POST /api/v1/invitations` | Space admin. Invites an email to the space; the single-use token is delivered out of band and is never in the response. 201. |
| `POST /api/v1/invitations/accept` | Public — the invitee has no session, the token is the credential. Creates/links exactly one user and one membership, then opens a profile-completion session. Replay answers 401. |
| `GET /api/v1/dvr` | Bearer. The space's recorder without its password. |
| `PUT /api/v1/dvr` | Space admin. Initialize or re-point the recorder: connectivity is tested first, and a configuration that cannot be reached is not stored. Discovers and reconciles the camera channels. |
| `POST /api/v1/dvr/discovery` | Space admin. Re-runs discovery against the stored credentials. Matching channels keep their configuration; channels that stopped answering become `isConfigured: false`. |
| `POST /api/v1/dvr/connection-test` | Space admin. Probes the recorder carried in the body — reachable, credentials accepted — and stores nothing: no configuration, no cameras, not even `lastTestAt`. Body carries credentials only, a time zone is rejected. |
| `GET /api/v1/cameras`, `GET /api/v1/cameras/:id` | Cameras of the caller's space, soft-deleted ones excluded. Carries the discovery fields, the monitor configuration and a derived `latestSnapshotUrl`. |
| `PUT /api/v1/cameras/:id` | Space admin. Operator-editable fields only — `externalId` and `status` are rejected. Full-frame monitoring requires an `alertType`. |
| `DELETE /api/v1/cameras/:id` | Space admin. Logical delete: the camera leaves every read and the poll list, its alert history stays. |
| `GET /api/v1/cameras/:id/status` | Pipeline status: last poll/success/error, latency, occupancy per monitored area. |
| `POST /api/v1/cameras/:id/snapshots` | Pulls a frame from the recorder now, stores it, answers with its authenticated URL. |
| `POST /api/v1/cameras/:id/analyze` | Multipart `file` upload (image, max `SNAPSHOT_MAX_BYTES`): runs the detection pipeline synchronously — manual path when the DVR is unreachable. |
| `GET /api/v1/snapshots/:id` | The stored image bytes, space-scoped. The only route that serves them. |
| `GET/POST /api/v1/cameras/:id/zones` | List / create percentage-rectangle monitor zones. Creating is admin-only. |
| `GET/PUT/DELETE /api/v1/zones/:id` | `PUT` validates the merged rectangle; `DELETE` is logical. Both admin-only. |
| `GET /api/v1/events` | Alert history of the caller's space, newest first. Filters: `alertType`, `from` (ISO 8601 lower bound). Keyset pagination: `limit` (default 25, max 100) plus the opaque `cursor` echoed back as `nextCursor`. |
| `GET /api/v1/events/:id` | One alert event. Carries the camera label copied at detection time, so a renamed or deleted camera does not rewrite it. |
| `GET /api/v1/events/:id/deliveries` | The outbound attempts planned for that event, one row per channel per recipient. Never returns the delivery `correlationId`. |
| `POST /api/v1/events/acknowledgements` | Public provider webhook. Body `{ correlationId }`. Answers `202 { accepted: true }` for a match, a repeat and an unknown id alike, so it reveals no event. Idempotent: the first callback acknowledges the event, later ones change nothing. |
| `GET /health/live`, `GET /health/ready` | Public. `ready` pings DB via Terminus. |
| `GET /health/dependencies` | Public. Separate from `ready`: short-timeout reachability check against face-auth upstream. Degraded upstream reports here **without** marking whole app not-ready (camera/zone CRUD still works). |
| WS namespace `/events` | JWT in handshake `auth.token`; the socket joins a room for the `spaceId` in its own claims, so an alert is fanned out only to its space. Emits `alert-event` with the same shape as `GET /api/v1/events/:id`. A token carrying no space is rejected. Clients are disconnected cleanly on graceful shutdown. |

Full interactive docs: `GET /docs` (Swagger UI), machine-readable spec at `/docs-json`.

## Auth model

JWT access + refresh, both signed with distinct secrets and TTLs (`JWT_SECRET`/`JWT_EXPIRES_IN`, `JWT_REFRESH_SECRET`/`JWT_REFRESH_EXPIRES_IN`). The access token carries the caller's `spaceId`, membership role, `profileCompleted` and active state, so a request needs no membership lookup to know its tenant. The refresh token travels **only** as an `httpOnly`, path-scoped cookie (`secure` in production), with `maxAge` derived from the token's own `exp` — never in a response body, and `/auth/refresh` accepts no body fallback.

**Refresh is stateful, not just signed.** Every refresh token has an `auth_tokens` row holding its hash, purpose, expiry and rotation parent. Refreshing looks the presented cookie up by hash, checks purpose/expiry/revocation, revokes it, and writes the rotated successor — one transaction, so a replayed cookie finds a revoked row and is rejected instead of minting a second live session. The same table backs magic links and password resets, one purpose per row; raw values exist only in the cookie or the delivered link, never in the database.

Three global guards, in order: `JwtAuthGuard` (every route unless `@Public()`), `RolesGuard` (`@Roles(SpaceMemberRole.admin)` on space configuration), and `ProfileCompletedGuard` — an account created by invitation arrives with no name, phone or usable password, and reaches nothing but `/auth/me` and `/auth/complete-profile` until it fills them in (`@AllowIncompleteProfile()` marks those two). `@CurrentUser()` reads the JWT payload off the request. A deactivated user, or one with no accepted membership, is rejected at login rather than issued a token. Cross-token misuse is rejected both directions — a refresh token used as a bearer access token fails signature verification (different secret) plus an explicit `type` check; an access token presented to `/auth/refresh` fails the same check the other way.

Face Auth is a second credential on the same accounts: `user_face_identities` stores only the hash of the provider token, many rows per user, and only an active one authenticates. Re-enrolling revokes the previous active identity in the same transaction instead of overwriting it, so a revocation stays visible.

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

`anchor` already normalized foot point (bbox bottom-center), scaled to percent before it is tested against a monitor rectangle. Upstream failures map to `UPSTREAM_TIMEOUT` or `UPSTREAM_ERROR` (upstream HTTP status in message, never `Fa-Token` value). Endpoint IP-throttled upstream — never poll faster than `POLLING_INTERVAL_SECONDS`.

Call wrapped in [`opossum`](https://github.com/nodeshift/opossum) **circuit breaker** (in-memory, one shared breaker per process — upstream is single tenant). Past failure threshold (50% over rolling window, `resetTimeout` 30s) breaker opens → short-circuits to `UPSTREAM_ERROR 'face-auth circuit open'` **without** attempting call — down/throttled upstream stops eating full `DETECT_TIMEOUT_MS` waits, stops being hammered. Single probe allowed after reset (half-open). Open/half-open/close transitions logged; current state readable via `FaceAuthClientService.circuitState`.

## Detection pipeline

`PipelineService.processImage` (`src/modules/pipeline/`) — single place full loop runs, whether triggered automatically or manually:

0. A camera that is soft-deleted, disabled or unconfigured is refused before anything else runs.
1. `SnapshotService.capture` pulls the frame through `DvrClientPort` and records the camera's reachability and freshness (`status`, `lastSnapshotAt`). `/analyze` supplies an uploaded image instead.
2. `FaceAuthClientService.detectPersons` gets bounding boxes + anchors back.
3. Persons below `PipelineDefaults.CONFIDENCE_THRESHOLD` filtered out.
4. `OccupancyEngine.evaluate` (`src/modules/pipeline/occupancy.engine.ts`) tests each anchor against the monitored rectangles — one implicit full-frame area in `monitorMode = full`, the camera's `monitor_zones` in `partial` — and applies **hysteresis**: an area is entered only after `ENTER_CONSECUTIVE_POLLS` consecutive polls with ≥1 anchor inside, and exited after `EXIT_CONSECUTIVE_POLLS` consecutive misses. Single missed/extra poll (flicker) raises nothing — a miss/hit during a pending transition resets the streak to zero, it does not decrement it.
5. Each entry becomes an alert candidate carrying the camera label as it read at detection time and the alert level of its area — `Camera.alertType` in full mode, the zone's own in partial. An alert stores the frame as a `snapshots` BLOB of its own, kept as evidence; the polling scheduler also refreshes the camera's single live row on every successful poll, whether it alerted or not. Persistence, WebSocket broadcast and channel delivery arrive with the alert-event domain.
6. `CameraStatusRegistry` records outcome (`lastPolledAt`, `lastSuccessAt`, `lastErrorCode`, `lastLatencyMs`, `lastPersonsDetected`, per-area occupancy) — surfaced at `GET /cameras/:id/status`.

`PollingScheduler` drives steps 1–6 automatically every `POLLING_INTERVAL_SECONDS` when `POLLING_ENABLED=true` (off by default in dev): one interval for the whole process, re-reading each tick which spaces own a recorder and which of their cameras are pollable. A camera whose previous poll is still in flight is counted as skipped, not queued behind it. After detection has run, the tick refreshes that camera's live frame (see [Snapshot storage](#snapshot-storage)); the write is deliberately last and its failure only recorded on the camera's status — a thumbnail must never be able to suppress an alert. `POST /cameras/:id/analyze` runs the same `processImage` synchronously against an uploaded image — the manual path when the DVR itself is unreachable.

## Snapshot storage

Frame bytes live in MySQL, in a `snapshots` `MEDIUMBLOB` alongside their camera, MIME type, byte size, SHA-256 and capture time. Why MySQL and not object storage, and what that costs: [`docs/decisions/001-mysql-snapshot-storage.md`](docs/decisions/001-mysql-snapshot-storage.md).

What that means operationally:

- **Bytes leave the process through exactly one route**, `GET /api/v1/snapshots/:id`, and only after the caller's space is matched through `camera.dvr.spaceId`. A snapshot id from another space answers `404`. No DTO anywhere carries the bytes — camera and event shapes carry a URL derived from the id.
- **Row count is bounded, write volume is not.** A frame that raises an alert gets its own immutable evidence row. Everything else shares one **live row per camera** (`snapshots.is_live`), overwritten in place: every successful poll refreshes it, and `POST /cameras/:id/snapshots` rewrites the same row instead of adding one. So a quiet camera costs one row forever, not one per `POLLING_INTERVAL_SECONDS` — but it does cost one BLOB write per tick per camera, which is the trade taken because retention is still unsolved and a path that runs forever must not add rows.
- **`SNAPSHOT_MAX_BYTES` is checked before the write**, against the same ceiling for stored and analyzed images. Its hard maximum is MySQL's `MEDIUMBLOB` limit of 16,777,215 bytes, so a value above that is rejected by the Joi schema at boot rather than by the database at 3am.
- **Nothing deletes them, ever.** There is no retention job, no TTL and no size cap on the table; it only grows. Camera deletion is logical, and `snapshots.camera_id` is `RESTRICT`, so even a physical camera purge would be refused while its frames exist — the bytes outlive the camera by design, because the alert history points at them. Sizing the disk and adding a retention schedule is operational work this plan deliberately deferred; watch `SELECT COUNT(*), SUM(byte_size) FROM snapshots` until it exists.
- **Backups carry the images.** A `mysqldump` of this schema is as large as the stored frames, so plan backup windows and restore times against snapshot volume, not against row counts.

Moving to object storage later touches the snapshot accessor, the snapshot service and the URL mapper — the rest of the domain refers to snapshots by id and does not care where the bytes are.

## Observability, resilience & supply chain

Infra concerns handled by frameworks below. **Every external integration is opt-in and no-ops cleanly when its env var is unset** — same posture as `OTEL_ENABLED`. Local dev never depends on running external service; production turns each on via env.

| Concern | Framework / tool | Where | How it's wired |
|---|---|---|---|
| Structured logging | `nestjs-pino` + `pino-http` | `src/cross/config/logger.options.ts` | JSON logs, per-request id, redaction driven by `SENSITIVE_FIELD_NAMES` — the same list Sentry's scrub reads, so a new secret-bearing field is covered on both channels at once. `pino-http` serializes `req`/`res` with its own serializers, so the `set-cookie` and `cookie` headers are redacted by explicit path on top of the deep redactor. Always on. |
| Tracing | OpenTelemetry SDK | `src/observability/tracing.ts`, `tracing.helpers.ts` | Opt-in via `OTEL_ENABLED`. Loaded **before** `ConfigModule` (reads `dotenv` itself). `withSpan(name, attrs, fn)` wraps spans; no-op when disabled. |
| Error tracking | `@sentry/node` | `src/observability/sentry.ts`, `main.ts`, `either.interceptor.ts` | Opt-in via `SENTRY_DSN`. `initSentry()` runs before `NestFactory.create`. `Sentry.captureException` fires **only** on interceptor's unexpected-500 branch — never for `Either` failures or mapped `HttpException` (no routine 4xx noise). `beforeSend`/`beforeBreadcrumb` both run `scrubSensitive`, which redacts every name in `SENSITIVE_FIELD_NAMES` — the same list the logging row above reads — at any depth in the event or breadcrumb, so a new secret-bearing field is added in one place. Unset DSN = zero network activity. |
| Credential mail | `nodemailer` | `src/modules/auth/smtp-credential-delivery.service.ts`, `auth.module.ts` | Opt-in via `MAIL_ENABLED`. Off = `LoggedCredentialDeliveryService`, the pre-transport behaviour, no relay contacted. Sends invitation/magic-link/password-reset links built from `APP_BASE_URL`. A send failure is logged and absorbed — never a 500, and never a signal that distinguishes a registered from an unregistered address. Neither the token nor the link is ever logged. |
| Resilience | `opossum` circuit breaker | `src/modules/face-auth-client/face-auth-client.service.ts` | See [face-auth contract](#face-auth-upstream-contract). In-memory, no infra dependency. |
| Health | `@nestjs/terminus` | `src/modules/health/` | `/health/live` (process), `/health/ready` (DB ping — LB readiness), `/health/dependencies` (face-auth reachability, **separate** so degraded upstream never marks app not-ready). All `@Public()`, version-neutral. |
| Graceful shutdown | Nest lifecycle hooks | `events.gateway.ts`, `polling.scheduler.ts`, `prisma.service.ts` | On `SIGINT`/`SIGTERM` (`enableShutdownHooks()`): scheduler stops issuing new poll ticks, WS server disconnects clients cleanly **before** Prisma disconnects — Nest's reverse teardown order (feature modules before shared `DataModule`) guarantees it. In-flight polls left to finish, not killed. |
| API contract | `@nestjs/swagger` + a committed artifact | `scripts/export-openapi.ts`, `openapi.json` | `openapi.json` — diffable, version-controlled artifact. CI regenerates it, fails on drift — run `npm run openapi:export` and commit after any DTO/route change. Live UI still at `/docs`, raw at `/docs-json`. Bearer is a document-level security requirement, and `@Public()` emits the per-operation opt-out alongside the guard metadata — so the contract cannot claim a public route needs a token, or the reverse. |
| Supply chain | `npm audit` + Dependabot | `.github/workflows/pr-tests.yml`, `.github/dependabot.yml` | CI gate `npm audit --omit=dev --audit-level=critical` blocks only production-dependency **critical** vulnerabilities (dev tooling doesn't ship; high transitive advisories churn constantly). Dependabot opens weekly grouped update PRs against `develop` for the rest. |

> **In flight** (open PRs, tracked in [`plans/02.infra-hardening.md`](plans/02.infra-hardening.md), not yet on `develop`): Prometheus `/metrics` (T04), SSH/PM2 deploy pipeline (T02), `sops`/`age` secrets (T06). Check [`plans/02.infra-hardening.tasks.md`](plans/02.infra-hardening.tasks.md) for live status before assuming any present. That plan's "`snapshotUrl` field encryption at rest" item is **closed by other means**: plan 03 removed the column, so no credential-bearing URL is persisted at all, and the field encryption it asked for now protects `dvrs.password_encrypted` instead.

## Testing

Three levels, matching plan's convention:

| Level | Suffix | Command | What it needs |
|---|---|---|---|
| Unit | `*.spec.ts` | `npm test` | Nothing — no DB, no network. |
| Integration | `*.int-spec.ts` | `npm run test:int` | Real local MySQL, `DATABASE_URL_TEST`. Truncates tables — **never** point it at the dev database. |
| E2E | `*.e2e-spec.ts` | `npm run test:e2e` | Same test DB; boots the real app (HTTP + WebSocket). Three ports are faked in `test/utils/bootstrap-e2e-app.ts` — face-auth detection, the DVR client, and credential delivery — so the whole tenant flow runs with no upstream, no recorder on the network and no relay, and a test can read the one-time token a real invitee would get by mail. |

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
| `DVR_PASSWORD_ENCRYPTION_KEY` | all-zero placeholder | Base64, must decode to **exactly 32 bytes** — the AES-256-GCM key for `dvrs.password_encrypted`. Required in production, where the placeholder committed in `.env.example` is rejected by name: it decodes to 32 valid bytes, so a length check alone would let a copied example file encrypt real recorder passwords under a key published in this repo. Rotating it makes every stored DVR password undecryptable — re-enter the recorder credentials through `PUT /dvr` after a rotation. Generate one with `openssl rand -base64 32`. |
| `FACE_AUTH_API_URL` / `FACE_AUTH_DOMAIN` / `FACE_AUTH_TOKEN` | — | Upstream face-auth tenant. Required in production. |
| `DETECT_TIMEOUT_MS` | `10000` | face-auth request timeout. |
| `POLLING_ENABLED` | `false` | Master switch for DVR polling scheduler. |
| `POLLING_INTERVAL_SECONDS` | `5` | Seconds between poll ticks, `1`–`3600`. One interval for the whole process, not one per camera. |
| `DVR_TIMEOUT_MS` | `5000` | Recorder channel-discovery timeout. |
| `SNAPSHOT_TIMEOUT_MS` | `5000` | DVR snapshot fetch timeout. |
| `SNAPSHOT_MAX_BYTES` | `2000000` | Largest frame accepted for storage or analysis, `1024`–`16777215`. The ceiling is MySQL's `MEDIUMBLOB` limit: a frame the column cannot hold is refused up front rather than after the recorder round trip and the detection call are already paid for. See [Snapshot storage](#snapshot-storage). |
| `ENTER_CONSECUTIVE_POLLS` / `EXIT_CONSECUTIVE_POLLS` | `2` / `3` | Occupancy hysteresis thresholds. |
| `THROTTLE_TTL_SECONDS` / `THROTTLE_LIMIT` | `1` / `10` | Inbound rate limit — production only. |
| `OTEL_ENABLED` | `false` | Opt-in OpenTelemetry tracing. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP HTTP collector. |
| `OTEL_SERVICE_NAME` | `tu-seguridad-back` | Reported service name. |
| `SENTRY_DSN` | — | Opt-in error tracking. Unset = disabled (no network activity). Only unexpected 500s reported; secrets scrubbed. |
| `MAIL_ENABLED` | `false` | Master switch for credential delivery over SMTP. Off = invitation/magic-link/reset tokens are only logged, no relay contacted. Forced off by the e2e harness. |
| `SMTP_HOST` / `SMTP_PORT` | `127.0.0.1` / `1025` | Defaults describe the local mailpit container ([`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md)). Port `465` switches to implicit TLS; anything else stays plain or negotiates STARTTLS. |
| `SMTP_USER` / `SMTP_PASSWORD` | — | Both optional. Empty user means authentication is skipped entirely, which is what mailpit wants. Never a `smtp://user:pass@host` URL — separate values keep `secretlint` quiet and the password out of a loggable string. |
| `MAIL_FROM` | `Tu Seguridad <no-reply@tu-seguridad.local>` | `From` header, address or `Name <address>` form. |
| `APP_BASE_URL` | `http://localhost:5173` | Origin the emailed links point at — the frontend, not this API. A subpath (`https://host/app`) is preserved. |

## Docs map

| File | What's in it |
|---|---|
| [`plans/01.setup.md`](plans/01.setup.md) | Full 25-task setup plan: domain model, API surface, env vars, per-task DoD. |
| [`plans/01.setup.tasks.md`](plans/01.setup.tasks.md) | Live status per task, how each verified. |
| [`plans/02.infra-hardening.md`](plans/02.infra-hardening.md) | Infra plan: CD, resilience, observability, security. Per-task DoD. |
| [`plans/02.infra-hardening.tasks.md`](plans/02.infra-hardening.tasks.md) | Live status + deviations for infra tasks (merged vs open). |
| [`plans/03.tenant-alert-data-model.md`](plans/03.tenant-alert-data-model.md) | The tenant/alert data-model plan: target relational model, cross-cutting scoping rules, T01–T08 with per-task DoD. |
| [`plans/03.tenant-alert-data-model.tasks.md`](plans/03.tenant-alert-data-model.tasks.md) | Live status per task, the design decisions taken along the way, verification evidence, and what was deliberately deferred. |
| [`plans/DATA_MODEL_REQUIREMENTS.md`](plans/DATA_MODEL_REQUIREMENTS.md) | The UI-derived input for plan 03: what the frontend screens need, kept distinct from the backend decisions. |
| [`docs/decisions/`](docs/decisions/) | Decision records. `001` — why snapshot bytes live in MySQL and what replacing that touches. |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Decisions behind the layering: accessor conventions, resilience/observability choices, deviations from plan. |
| [`AGENTS.md`](AGENTS.md) | Project facts, git identity, `Applicable standards` map, check commands, repo-specific rules, declared overrides. Read this before the central standards. |
| [`.standards/`](.standards/README.md) | Central engineering standards, consumed as a submodule. Read order, precedence, per-stack rules. Never edited from here. |
| [`docs/STANDARDS_GAPS.md`](docs/STANDARDS_GAPS.md) | Where this repo does not meet the central standards yet, and the fix for each. |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Pointers into the central workflow + what this repo's CI actually runs. |
| [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md) | Tooling/ops gotchas learned building this repo. |
| [`CLAUDE.md`](CLAUDE.md) | Claude Code specific notes on top of `AGENTS.md`. |

## Roadmap

- **02 — infra hardening** ([`plans/02.infra-hardening.md`](plans/02.infra-hardening.md), in progress): CD pipeline, circuit breaker, Prometheus metrics, Sentry, dependency scanning, `sops` secrets, deeper health checks + graceful shutdown, OpenAPI contract. **Deferred** in that plan: Docker, anything Redis-dependent (distributed throttler storage, cache, socket.io adapter, BullMQ) — cost-prohibitive at current scale.
- **03 — tenant alert data model** ([`plans/03.tenant-alert-data-model.md`](plans/03.tenant-alert-data-model.md), **done**): spaces, memberships and invitations, DVR-owned cameras, rectangle monitor zones, MySQL snapshots, alert history and delivery planning.
- **Deferred out of 03, in rough order of need:**
  - The notification provider itself. Delivery rows are planned and stay `pending` — `sent`/`failed`, `providerMessageId` and `error` exist in the schema with no writer. The sender interface ships with the provider that needs it, not before.
  - Webhook authentication for `POST /events/acknowledgements`. It is public today and the correlation id is its only credential.
  - Snapshot retention and the move to object storage ([Snapshot storage](#snapshot-storage)), plus alert-event retention and partitioning.
  - Detection cooldown and deduplication — a camera that keeps seeing someone raises one alert per hysteresis cycle, and nothing suppresses a burst.
  - Poll versus DVR push/WebSocket. Both must drive the same discovery, status and snapshot services; the schema does not pick a winner.
- **04** — Per-track events (`track_id`) once face-auth exposes tracking; `PERSON_UPDATED_IN_ZONE`; movement-vs-presence rules; authorization of known persons; alert schedules.
- DVR snapshot reliability (retries, backoff, reconnection metrics), per-camera FPS tuning, per-camera confidence threshold (today the pipeline uses one `PipelineDefaults.CONFIDENCE_THRESHOLD` for every camera).
