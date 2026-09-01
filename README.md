# tu-seguridad-back

Backend for "person detection in restricted zones" system. 8 home cameras behind DVR/NVR. Owns tenant/camera/zone config (MySQL), detection-pipeline orchestration, zone evaluation (percentage outlines + hysteresis), alert history, live event push to frontend over WebSocket. Person detection delegated to external upstream API ([face-auth](#face-auth-upstream-contract)) — backend sends snapshots, gets back bounding boxes + precomputed foot-point anchor.

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
| Live video | MediaMTX sidecar restreams the recorder RTSP as HLS, on demand, no transcoding — opt-in via `MEDIAMTX_ENABLED` |
| Resilience | `opossum` circuit breaker around face-auth upstream (in-memory, no infra) |
| API contract | committed `openapi.json`, exported by `scripts/export-openapi.ts`, diff-checked in CI |
| Supply chain | `npm audit` gate (prod deps, critical) + Dependabot (weekly, targets `develop`) |
| ORM | Prisma + `@prisma/client`, MySQL, migrations + seed |
| Outbound HTTP | `@nestjs/axios` (face-auth client, DVR snapshot fetch) |
| Image annotation | `sharp` — draws the upstream's detection boxes into the evidence frame before it is stored |
| Scheduling | `@nestjs/schedule` (per-camera DVR polling) |
| WebSockets | `@nestjs/websockets` + socket.io, namespace `/events` |
| Tests | Jest — unit / integration / e2e (see [Testing](#testing)) |
| Git hooks | husky + lint-staged + commitlint (Conventional Commits) |
| Prod | PM2 (`ecosystem.config.js`), fork mode, graceful shutdown |

## Quickstart

```bash
nvm use                          # Node 22, see .nvmrc
npm ci
cp .env.example .env             # fill real MySQL creds + face-auth domain/client token
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
| `GET /api/v1/invitations` | Space admin. The invitations that are neither accepted nor expired, newest first. Same shape as the creation response, so the token is absent here too. |
| `POST /api/v1/invitations/accept` | Public — the invitee has no session, the token is the credential. Creates/links exactly one user and one membership, then opens a profile-completion session. Replay answers 401. |
| `GET /api/v1/members` | Bearer. The roster of the caller's space as `{items,total}`, oldest membership first. Deactivated members stay in the list — the state is a field, not an omission, and `profileCompleted` marks a member that accepted an invitation but never filled in its name and phone. Carries no role. `receiveAlerts` is the per-member alert opt-in the channels screen toggles — a member with it off stays in the space and gets no delivery planned. |
| `PATCH /api/v1/members/:userId` | Space admin. Flips one member's `receiveAlerts`. The id is the user id the roster returns, and the member is scoped to the caller's space — a member of another space answers `404`. Nothing else about the member is editable here. |
| `GET /api/v1/alert-routings` | Bearer. The routing matrix of the caller's space as `{items}`: one cell per alert type per channel. Always the complete grid — a cell the space never saved is answered with its default rather than omitted, so the screen has nothing to guess. |
| `PUT /api/v1/alert-routings` | Space admin. Saves the matrix in one transaction, so a half-applied grid is never observable. Partial bodies are allowed — the cells that are not sent keep their stored value — and the response is the full grid either way. |
| `GET /api/v1/dvr` | Bearer. The space's recorder without its password. |
| `PUT /api/v1/dvr` | Space admin. Initialize or re-point the recorder: connectivity is tested first, and a configuration that cannot be reached is not stored. Discovers and reconciles the camera channels. |
| `POST /api/v1/dvr/discovery` | Space admin. Re-runs discovery against the stored credentials. Matching channels keep their configuration; channels that stopped answering become `isConfigured: false`. |
| `POST /api/v1/dvr/connection-test` | Space admin. Probes the recorder carried in the body — reachable, credentials accepted — and stores nothing: no configuration, no cameras, not even `lastTestAt`. Body carries credentials only, a time zone is rejected. |
| `GET /api/v1/cameras`, `GET /api/v1/cameras/:id` | Cameras of the caller's space, soft-deleted ones excluded. Carries the discovery fields, the monitor configuration and a derived `latestSnapshotUrl`. |
| `PUT /api/v1/cameras/:id` | Space admin. Operator-editable fields only — `externalId` and `status` are rejected. Full-frame monitoring requires an `alertType`. |
| `DELETE /api/v1/cameras/:id` | Space admin. Logical delete: the camera leaves every read and the poll list, its alert history stays. |
| `GET /api/v1/cameras/:id/status` | Pipeline status: last poll/success/error, latency, occupancy per monitored area. |
| `GET /api/v1/cameras/:id/live` | Where to play the camera: `{protocol: 'hls', url}`. Registers the channel with the media server, which pulls RTSP only while somebody watches. Carries no recorder credential, and the URL is not a secret — every playlist and segment is authorized separately. Answers `CONFLICT` when `MEDIAMTX_ENABLED` is off. |
| `POST /api/v1/cameras/:id/snapshots` | Pulls a frame from the recorder now, stores it, answers with its authenticated URL. |
| `POST /api/v1/cameras/:id/analyze` | Multipart `file` upload (image, max `SNAPSHOT_MAX_BYTES`): runs the detection pipeline synchronously — manual path when the DVR is unreachable. |
| `GET /api/v1/snapshots/:id` | The stored image bytes, space-scoped. The only route that serves them. |
| `GET/POST /api/v1/cameras/:id/zones` | List / create monitor zones, in percent of the frame. A zone is a free-hand outline (`points`) with the rectangle columns as its bounding box; a request without `points` is a plain rectangle, and the response answers the four corners either way. Coordinates are rounded to two decimals — the stored precision — before the frame-bounds check. Creating is admin-only. |
| `GET/PUT/DELETE /api/v1/zones/:id` | `PUT` validates the merged shape and re-derives the bounding box from a new outline; moving the box of an outlined zone without sending `points` is refused rather than dropping the outline. `DELETE` is logical. Both admin-only. |
| `GET /api/v1/events` | Alert history of the caller's space, newest first. Carries what the pipeline measured on the frame that raised it — `personsDetected` and `confidence`, both null on an alert recorded before those columns existed. Filters: `alertType`, `from` (ISO 8601 lower bound). Keyset pagination: `limit` (default 25, max 100) plus the opaque `cursor` echoed back as `nextCursor`. |
| `GET /api/v1/events/:id` | One alert event. Carries the camera label copied at detection time, so a renamed or deleted camera does not rewrite it. |
| `GET /api/v1/events/:id/deliveries` | The outbound attempts planned for that event, one row per channel per recipient. Never returns the delivery `correlationId`. `email` rows carry their real outcome — `sent` with the relay's message id, or `failed` with the reason; `call` and `whatsapp` stay `pending` until those channels get a sender. |
| `POST /api/v1/events/acknowledgements` | Public. Body carries exactly one credential, and which one says who is calling: `{ correlationId }` from a notification provider, or `{ token }` from the acknowledge link of an alert email. Answers `202 { accepted: true }` for a match, a repeat, an unknown id and a token that fails its signature alike, so it reveals no event. Both credentials at once, or neither, is `400`. Idempotent: the first call acknowledges the event, later ones change nothing. |
| `POST /api/v1/streaming/authorize` | Public media-server hook, called for the HLS playlist and **every** segment. The reader bearer token arrives in the body, validated by the same verifier the bearer guard uses. Only `read` over `hls`, only a camera inside the space the token names — a granted `publish` would let someone feed fake video to the dashboard. |
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

**Two calls, not one.** The detection endpoints do not accept `FACE_AUTH_CLIENT_TOKEN`. It buys a session token first:

```
POST {FACE_AUTH_API_URL}/api/v1/auth/authorize
  Fa-Domain: {FACE_AUTH_DOMAIN}
  Fa-Client-Token: {FACE_AUTH_CLIENT_TOKEN}
-> 201 { "isAuth": true, "token": "..." }
```

That `token` is what travels as `Fa-Token`. Sending the client token directly answers `403` on **every** call, which reads as an upstream outage and opens the circuit after two frames — so this is not an optimization, it is the difference between detection running and never running. The session token is opaque (no readable expiry), so it is cached in memory until the upstream refuses it: a `403` clears the cache, re-authorizes **once**, and retries. A second `403` is a real failure, not another exchange — a revoked client token must not become an authorize loop.

`FaceAuthClientService` (`src/modules/face-auth-client/`) then POSTs the camera snapshot as `multipart/form-data` to `{FACE_AUTH_API_URL}/api/v1/persons` with `Fa-Domain`/`Fa-Token` headers → gets back:

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

**Contract observed against the live service on 2026-08-28** — two photographs of people, `201` on both, four detections each with `detScore` between 0.54 and 0.85, every field above present under exactly these names and types. Worth stating because the section read the same while the endpoint answered `500 UNHANDLED_ERROR` to everything: what it described had never been seen to come back.

`anchor` already normalized foot point (bbox bottom-center), scaled to percent before it is tested against a monitor rectangle — an anchor on the frame edge (`y: 1`) lands at exactly 100% and counts as inside, since every containment bound is inclusive. The response is checked at the edge: `persons[]` entries must carry a numeric `detScore` and `anchor`, or the body is refused as `UPSTREAM_ERROR` instead of being passed on. Only those two are validated because only those two are read — a renamed `anchor` would otherwise reach the rectangle test as `NaN`, and the camera would stop alerting with nothing in the log. Upstream failures map to `UPSTREAM_TIMEOUT` or `UPSTREAM_ERROR` (upstream HTTP status in message, never `Fa-Token` value). Endpoint IP-throttled upstream — never poll faster than `POLLING_DETECTION_SECONDS`, the shortest rung of the [poll cadence ladder](#detection-pipeline).

Call wrapped in [`opossum`](https://github.com/nodeshift/opossum) **circuit breaker** (in-memory, one shared breaker per process — upstream is single tenant). Past failure threshold (50% over rolling window, `resetTimeout` 30s) breaker opens → short-circuits to `UPSTREAM_ERROR 'face-auth circuit open'` **without** attempting call — down/throttled upstream stops eating full `DETECT_TIMEOUT_MS` waits, stops being hammered. Single probe allowed after reset (half-open). Open/half-open/close transitions logged; current state readable via `FaceAuthClientService.circuitState`.

## Detection pipeline

`PipelineService.processImage` (`src/modules/pipeline/`) — single place full loop runs, whether triggered automatically or manually:

0. A camera that is soft-deleted, disabled or unconfigured is refused before anything else runs.
1. `SnapshotService.capture` pulls the frame through `DvrClientPort` and records the camera's reachability and freshness (`status`, `lastSnapshotAt`). `/analyze` supplies an uploaded image instead.
2. `FaceAuthClientService.detectPersons` gets bounding boxes + anchors back.
3. Persons below `PipelineDefaults.CONFIDENCE_THRESHOLD` filtered out.
4. `OccupancyEngine.evaluate` (`src/modules/pipeline/occupancy.engine.ts`) tests each anchor against the monitored areas — the outline when the operator drew one, its bounding box otherwise; one implicit full-frame area in `monitorMode = full`, the camera's `monitor_zones` in `partial` — and applies **hysteresis**: an area is entered only after `ENTER_CONSECUTIVE_POLLS` consecutive polls with ≥1 anchor inside, and exited after `EXIT_CONSECUTIVE_POLLS` consecutive misses. Single missed/extra poll (flicker) raises nothing — a miss/hit during a pending transition resets the streak to zero, it does not decrement it.
5. Each entry becomes an alert candidate carrying the camera label as it read at detection time, the alert level of its area, how many anchors were inside (`personsDetected`) and the highest `detScore` among them (`confidence`) — `Camera.alertType` in full mode, the zone's own in partial. An alert stores the frame as a `snapshots` BLOB of its own, kept as evidence, with every detection above the threshold outlined in green and tagged with its `detScore` (`annotate-frame.ts`) — burnt into the pixels, so the alert email and the dashboard show the same annotated frame and no mail client can drop the overlay. A frame the encoder cannot read is stored unannotated, and a write the re-encoded bytes are refused for is retried with the frame as captured — an alert with no evidence at all is the worse outcome; the polling scheduler also refreshes the camera's single live row on every successful poll, whether it alerted or not. Persistence, WebSocket broadcast and channel delivery arrive with the alert-event domain.
6. `CameraStatusRegistry` records outcome (`lastPolledAt`, `lastSuccessAt`, `lastErrorCode`, `lastLatencyMs`, `lastPersonsDetected`, per-area occupancy) — surfaced at `GET /cameras/:id/status`.

`PollingScheduler` drives steps 1–6 automatically when `POLLING_ENABLED=true` (off by default in dev): one interval for the whole process, re-reading each tick which spaces own a recorder and which of their cameras are pollable. A camera whose previous poll is still in flight is counted as skipped, not queued behind it, and one that throws unexpectedly is logged and recorded on its own status rather than ending the tick — otherwise a single bad camera would stop every remaining camera and space from being monitored. After detection has run, the tick refreshes that camera's live frame (see [Snapshot storage](#snapshot-storage)); the write is deliberately last and its failure only recorded on the camera's status — a thumbnail must never be able to suppress an alert. `POST /cameras/:id/analyze` runs the same `processImage` synchronously against an uploaded image — the manual path when the DVR itself is unreachable.

### Poll cadence

How often a camera is polled follows what its last frame showed, so a quiet camera is cheap and an interesting one is fast. `CadenceEngine` (`src/modules/pipeline/cadence.engine.ts`) holds a level per camera:

| Level | Env var | Default | When |
| --- | --- | --- | --- |
| `passive` | `POLLING_PASSIVE_SECONDS` | `15` | no person in the frame |
| `active` | `POLLING_ACTIVE_SECONDS` | `10` | person in the frame, no zone pending |
| `detection` | `POLLING_DETECTION_SECONDS` | `5` | a monitored area is entered, or its exit is not confirmed yet |

Cameras still carry no timer of their own: the single interval ticks at the **shortest** of the three, and a camera not yet due sits the tick out before any recorder request, detection call or live-frame write happens. There is deliberately no separate base-tick setting — a fourth knob could only ever be configured out of step with the three it serves.

The level goes **up on the raw sighting and down on the confirmed one**. A person inside a monitored area puts it past `Outside` on the very first frame, so the camera is already at `detection` while the hysteresis of step 4 is still confirming the entry — the confirming poll arrives one `POLLING_DETECTION_SECONDS` later instead of one passive interval later. It then holds `detection` until the hysteresis has actually retired the area. Stepping down on the first empty frame instead would leave the area stuck `Inside` for `EXIT_CONSECUTIVE_POLLS` passive-length polls, and a second person walking in during that window would raise no alert at all.

A poll that fails — unreachable recorder, upstream detection error, or a skip because the previous poll is still in flight — re-arms the camera at the level it already had. The frame said nothing about how fast to go, and dropping an unreachable recorder back onto the base tick would hammer exactly the thing already struggling.

A `monitorMode = full` camera never sees `active`: its whole frame is the monitored area, so any person it detects is already a detection. The current level is on `GET /cameras/:id/status` as `pollLevel` / `pollIntervalSeconds`, and each real transition logs one line.

## Alert emails

An alert raised by the pipeline is fanned out into one `event_deliveries` row per enabled channel per opted-in active member — the routing matrix (`PUT /alert-routings`) crossed with the roster's `receiveAlerts` flag. Email is the one channel with a sender; `call` and `whatsapp` rows are planned and stay `pending`.

- **The switch is `MAIL_ENABLED`**, the same one credential mail uses, over the same transport (`src/cross/mail/mailer.service.ts`). Off, nothing is sent and every row stays `pending` — a machine with no relay behaves exactly as before a sender existed. Local setup, and pointing the same code at Gmail: [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).
- **What the mail says**: the alert type, the camera label copied at detection time, the number of people in the frame, the detection confidence as a whole percent, and the captured frame itself, inline — with each detection outlined in green and its own confidence on the box. The timestamp is wall-clock at the recorder (`Dvr.timezone`, UTC when the space has no DVR) — a UTC time in an alert is a puzzle to solve at the wrong moment.
- **Two actions, both one click**: *View the alert* opens `APP_BASE_URL/events/:id` in the dashboard, and *Mark as handled* opens `APP_BASE_URL/events/:id/acknowledge?token=…`, whose page posts that token to `POST /events/acknowledgements`. Both are frontend routes this API assumes, like every credential link — see [Acknowledging from a mail](#acknowledging-from-a-mail).
- **The boxes are burnt in, not overlaid.** The frame that arrives already carries them, drawn when the alert stored it ([Detection pipeline](#detection-pipeline)). An absolutely positioned overlay is the first thing a mail client drops, and it drops it silently — a box that only renders in Gmail is worse than no box.
- **The frame is embedded, not linked** — a `cid:` attachment, so it renders with no remote fetch, no tracking pixel and no "images blocked" banner. A link to `GET /snapshots/:id` would show a logged-out recipient nothing. This is the one place snapshot bytes leave the process besides that route, it goes only to an opted-in member of the space that owns the camera, and the rule is written down in [`AGENTS.md`](AGENTS.md).
- **What it never carries**: the delivery `correlationId`. That is the credential a provider callback uses, and mailing it would hand a working acknowledgement to anyone who reads the mailbox, forever.
- **Outcome per row**: `sent` with the relay's message id, or `failed` with the reason. Both writes are guarded on the row still being `pending`, so an acknowledgement that arrives while the send is in flight is not overwritten.
- **Not awaited.** The socket broadcast reaches the dashboard first, and an SMTP round trip per recipient never delays it or the camera's next poll. The cost of that: no retry, no queue, and a process restart mid-fan-out leaves the rest `pending` for good. A relay failure fails one row and the loop continues.

### Acknowledging from a mail

The *Mark as handled* button carries a per-delivery token — an HMAC over the delivery id, keyed by `JWT_SECRET` and domain-separated, so nothing is persisted, the link survives a restart, and rotating the secret invalidates every link already sent. It is deliberately not the `correlationId`.

The link opens the **frontend**, which posts the token to `POST /api/v1/events/acknowledgements`. Two reasons it is not a link straight into this API: a token in a URL this process serves would land in its own access log on every click, whereas in a request body it is redacted (`token` is on `SENSITIVE_FIELD_NAMES`); and a `GET` that acknowledges would be triggered by every link scanner and prefetcher between the relay and the reader, silently marking an intruder alert as handled by nobody.

**The frontend route this assumes:** `GET <APP_BASE_URL>/events/:id/acknowledge?token=…` — a page that posts `{ token }` to the API and then sends the reader to `/events/:id`. It needs no session: the token is the whole credential, which is the point, since a recipient reading mail on a phone usually is not logged in. The assumption is stated in `alert-email.service.ts`, next to the one the credential mails already make.

That page is implemented in `tu-seguridad-front` and sends nothing until its button is pressed — a link scanner that renders the page would otherwise acknowledge on the reader's behalf, which is the same reason this side is not a `GET`. The *View the alert* button currently lands on the history list: the frontend has no per-event screen yet, and the mail already sends the id for the day it does.

Whoever clicks first wins: the acknowledgement records that recipient, and later clicks — from another recipient, another channel, or the same link twice — change nothing.

## Snapshot storage

Frame bytes live in MySQL, in a `snapshots` `MEDIUMBLOB` alongside their camera, MIME type, byte size, SHA-256 and capture time. Why MySQL and not object storage, and what that costs: [`docs/decisions/001-mysql-snapshot-storage.md`](docs/decisions/001-mysql-snapshot-storage.md).

What that means operationally:

- **Bytes leave the process through exactly one route**, `GET /api/v1/snapshots/:id`, and only after the caller's space is matched through `camera.dvr.spaceId`. A snapshot id from another space answers `404`. No DTO anywhere carries the bytes — camera and event shapes carry a URL derived from the id.
- **Row count is bounded, write volume is not.** A frame that raises an alert gets its own immutable evidence row. Everything else shares one **live row per camera** (`snapshots.is_live`), overwritten in place: every successful poll refreshes it, and `POST /cameras/:id/snapshots` rewrites the same row instead of adding one. So a quiet camera costs one row forever, not one per poll — but it does cost one BLOB write per poll per camera, which the [poll cadence ladder](#poll-cadence) stretches to `POLLING_PASSIVE_SECONDS` while nothing is happening, which is the trade taken because retention is still unsolved and a path that runs forever must not add rows.
- **`SNAPSHOT_MAX_BYTES` is checked before the write**, against the same ceiling for stored and analyzed images. Its hard maximum is MySQL's `MEDIUMBLOB` limit of 16,777,215 bytes, so a value above that is rejected by the Joi schema at boot rather than by the database at 3am.
- **Nothing deletes them, ever.** There is no retention job, no TTL and no size cap on the table; it only grows. Camera deletion is logical, and `snapshots.camera_id` is `RESTRICT`, so even a physical camera purge would be refused while its frames exist — the bytes outlive the camera by design, because the alert history points at them. Sizing the disk and adding a retention schedule is operational work this plan deliberately deferred; watch `SELECT COUNT(*), SUM(byte_size) FROM snapshots` until it exists.
- **Backups carry the images.** A `mysqldump` of this schema is as large as the stored frames, so plan backup windows and restore times against snapshot volume, not against row counts.

Moving to object storage later touches the snapshot accessor, the snapshot service and the URL mapper — the rest of the domain refers to snapshots by id and does not care where the bytes are.

## Live streaming

Still frames and live video are two different paths on purpose. The configuration screens and the
zone editor read the stored snapshot ([Snapshot storage](#snapshot-storage)); the dashboard plays
video. Why this shape and what was rejected:
[`docs/decisions/002-hls-live-streaming.md`](docs/decisions/002-hls-live-streaming.md).

```
Hikvision DVR  --RTSP/H.264-->  MediaMTX  --HLS-->  hls.js  -->  <video>
```

**MediaMTX is a separate process, not a library in this API.** The backend never touches a media
packet: `GET /cameras/:id/live` authorizes the camera, registers its path with MediaMTX's Control
API, and answers `{ protocol: 'hls', url }`. From there the browser talks to the media server
directly. MediaMTX pulls the recorder only while somebody is watching (`sourceOnDemand`) and
repackages without transcoding while the channel is H.264.

### Running it locally

The media server ships here as a container. Nothing in the API needs it to boot —
`MEDIAMTX_ENABLED=false` is the default and makes `GET /cameras/:id/live` answer `CONFLICT` without
contacting anything.

```bash
scripts/mediamtx.sh env      # add the four MEDIAMTX_* keys to .env (idempotent)
scripts/mediamtx.sh up       # start the container, then verify every leg
```

`scripts/mediamtx.sh check` is the thing to run when a live view will not play. It exercises the
real path rather than reading configuration: it registers a throwaway path over the Control API, asks
for its playlist without a token, and expects the `401` that proves MediaMTX reached
`POST /api/v1/streaming/authorize` and honoured its answer. It also preflights the HLS endpoint from
the frontend's origin, which is where a working setup usually fails — hls.js sends the token as a
header, so every request is preflighted, and a mismatched `hlsAllowOrigins` kills playback with
nothing logged on either side.

Config lives in [`docker/mediamtx.yml`](docker/mediamtx.yml) and is mounted, not baked, so there is
no Dockerfile and no rebuild to change a port. Two settings there are load-bearing and easy to break:
`authHTTPExclude` must keep `action: api` or MediaMTX denies this API's own path registrations, and
the container reaches the API over `host.docker.internal` because loopback inside a container is the
container. `docker-compose.yml` publishes ports rather than using `network_mode: host`: host
networking is a no-op on any VM-backed engine, Docker Desktop for Linux included, and it fails
silently with MediaMTX logging that it is listening.

**The URL is not a credential.** The path name is the camera id, and MediaMTX asks
`POST /api/v1/streaming/authorize` to authorize the playlist and every segment. The frontend
attaches its ordinary access token as a header — nothing new is minted, no token in a query string:

```js
const hls = new Hls({
  xhrSetup: (xhr) => xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`),
})
hls.loadSource(url) // the `url` from GET /cameras/:id/live
hls.attachMedia(videoElement)
```

Only `read` over `hls` is ever authorized. A granted `publish` would let a caller push their own
video into a camera's path and the dashboard would render it as that camera's feed.

**The media server needs its own API excluded from the hook.** `authMethod: http` sends *every*
MediaMTX action to `authHTTPAddress`, Control API calls included, and this hook grants nothing but
`read` — so an unexcluded `action: api` denies the very `paths/replace` call that registers a
camera, and no stream ever starts. Stock MediaMTX excludes it by default; nothing here enforces
that, so the operator config is explicit:

```yaml
authMethod: http
authHTTPAddress: http://<api-host>:3000/api/v1/streaming/authorize
authHTTPExclude:
  - action: api
  - action: metrics
  - action: pprof
```

**Off by default.** Without `MEDIAMTX_ENABLED` the route answers `CONFLICT` before it reads
anything, so local dev and CI need no media server. The recorder password reaches MediaMTX — nothing
else can open the RTSP connection — and never reaches the browser.

**Not solved yet:** the recorder sits on a LAN behind NAT, so a MediaMTX outside that network cannot
see it. Today both run on the same LAN. Opening port 554 to the internet is not the fix; a tunnel is.

## Observability, resilience & supply chain

Infra concerns handled by frameworks below. **Every external integration is opt-in and no-ops cleanly when its env var is unset** — same posture as `OTEL_ENABLED`. Local dev never depends on running external service; production turns each on via env.

| Concern | Framework / tool | Where | How it's wired |
|---|---|---|---|
| Structured logging | `nestjs-pino` + `pino-http` | `src/cross/config/logger.options.ts` | JSON logs, per-request id, redaction driven by `SENSITIVE_FIELD_NAMES` — the same list Sentry's scrub reads, so a new secret-bearing field is covered on both channels at once. `pino-http` serializes `req`/`res` with its own serializers, so the `set-cookie` and `cookie` headers are redacted by explicit path on top of the deep redactor. Always on. |
| Tracing | OpenTelemetry SDK | `src/observability/tracing.ts`, `tracing.helpers.ts` | Opt-in via `OTEL_ENABLED`. Loaded **before** `ConfigModule` (reads `dotenv` itself). `withSpan(name, attrs, fn)` wraps spans; no-op when disabled. |
| Error tracking | `@sentry/node` | `src/observability/sentry.ts`, `main.ts`, `either.interceptor.ts` | Opt-in via `SENTRY_DSN`. `initSentry()` runs before `NestFactory.create`. `Sentry.captureException` fires **only** on interceptor's unexpected-500 branch — never for `Either` failures or mapped `HttpException` (no routine 4xx noise). `beforeSend`/`beforeBreadcrumb` both run `scrubSensitive`, which redacts every name in `SENSITIVE_FIELD_NAMES` — the same list the logging row above reads — at any depth in the event or breadcrumb, so a new secret-bearing field is added in one place. Unset DSN = zero network activity. |
| Credential mail | `nodemailer` | `src/modules/auth/smtp-credential-delivery.service.ts`, `auth.module.ts` | Opt-in via `MAIL_ENABLED`. Off = `LoggedCredentialDeliveryService`, the pre-transport behaviour, no relay contacted. Sends invitation/magic-link/password-reset links built from `APP_BASE_URL`. A send failure is logged and absorbed — never a 500, and never a signal that distinguishes a registered from an unregistered address. Neither the token nor the link is ever logged. |
| Live video | MediaMTX (external) | `src/modules/streaming/` | Opt-in via `MEDIAMTX_ENABLED`. Off = one `CONFLICT`, nothing contacted. On = the path is registered through the Control API with `sourceOnDemand`, so the recorder RTSP is pulled only while somebody watches and dropped when the last reader leaves. This process never touches a media packet. See [`docs/decisions/002-hls-live-streaming.md`](docs/decisions/002-hls-live-streaming.md). |
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
| E2E | `*.e2e-spec.ts` | `npm run test:e2e` | Same test DB; boots the real app (HTTP + WebSocket). Four ports are faked in `test/utils/bootstrap-e2e-app.ts` — face-auth detection, the DVR client, credential delivery and the stream publisher — so the whole tenant flow runs with no upstream, no recorder on the network, no relay and no media server, and a test can read the one-time token a real invitee would get by mail. |

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
| `FACE_AUTH_API_URL` / `FACE_AUTH_DOMAIN` / `FACE_AUTH_CLIENT_TOKEN` | — | Upstream face-auth tenant. Required in production. `FACE_AUTH_CLIENT_TOKEN` is the tenant's long-lived **client** token — exchanged for a session token, never sent to a detection endpoint. Renamed from `FACE_AUTH_TOKEN`, which held the same value under a name implying it was the credential `/persons` accepts. |
| `DETECT_TIMEOUT_MS` | `10000` | face-auth request timeout. |
| `POLLING_ENABLED` | `false` | Master switch for DVR polling scheduler. |
| `POLLING_PASSIVE_SECONDS` | `15` | Poll cadence for a camera whose last frame held nobody, `1`–`3600`. See [Poll cadence](#poll-cadence). |
| `POLLING_ACTIVE_SECONDS` | `10` | Poll cadence with a person in the frame but no monitored area pending, `1`–`3600`. |
| `POLLING_DETECTION_SECONDS` | `5` | Poll cadence while a monitored area is entered or its exit is unconfirmed, `1`–`3600`. The process ticks at the shortest of the three. |
| `DVR_TIMEOUT_MS` | `5000` | Recorder channel-discovery timeout. |
| `DVR_RTSP_PORT` | `554` | RTSP is a separate service from the stored ISAPI base URL, which carries only the HTTP port. A knob and not a `dvrs` column because a space owns one recorder and none of them moves 554. |
| `DVR_RTSP_STREAM` | `sub` | `sub \| main`. The sub-stream by default: the dashboard plays this in a hover-sized box, and the recorder uplink carries every viewer — roughly 0.5–1 Mbps against 2–4 for the main stream. |
| `MEDIAMTX_ENABLED` | `false` | Master switch for live streaming. Off = `GET /cameras/:id/live` answers `CONFLICT` and no media server is contacted. |
| `MEDIAMTX_API_URL` | `http://127.0.0.1:9997` | MediaMTX Control API. **Private by definition** — it accepts recorder credentials and authenticates nobody, so it must never be bound to a public interface. |
| `MEDIAMTX_PUBLIC_URL` | `http://127.0.0.1:8888` | HLS base the browser reaches. Not the same address as above: one is reached by this process, the other by the operator's laptop. |
| `MEDIAMTX_TIMEOUT_MS` | `5000` | Control API request timeout. |
| `SNAPSHOT_TIMEOUT_MS` | `5000` | DVR snapshot fetch timeout. |
| `SNAPSHOT_MAX_BYTES` | `2000000` | Largest frame accepted for storage or analysis, `1024`–`16777215`. The ceiling is MySQL's `MEDIUMBLOB` limit: a frame the column cannot hold is refused up front rather than after the recorder round trip and the detection call are already paid for. See [Snapshot storage](#snapshot-storage). |
| `ENTER_CONSECUTIVE_POLLS` / `EXIT_CONSECUTIVE_POLLS` | `2` / `3` | Occupancy hysteresis thresholds. |
| `THROTTLE_TTL_SECONDS` / `THROTTLE_LIMIT` | `1` / `10` | Inbound rate limit — production only. |
| `OTEL_ENABLED` | `false` | Opt-in OpenTelemetry tracing. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP HTTP collector. |
| `OTEL_SERVICE_NAME` | `tu-seguridad-back` | Reported service name. |
| `SENTRY_DSN` | — | Opt-in error tracking. Unset = disabled (no network activity). Only unexpected 500s reported; secrets scrubbed. |
| `MAIL_ENABLED` | `false` | Master switch for every outbound mail: credential delivery and alert emails both. Off = invitation/magic-link/reset tokens are only logged and planned alert deliveries stay `pending`, no relay contacted. Forced off by the e2e harness. |
| `SMTP_HOST` / `SMTP_PORT` | `127.0.0.1` / `1025` | Defaults describe the local mailpit container ([`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md)). Port `465` switches to implicit TLS; anything else stays plain or negotiates STARTTLS. |
| `SMTP_USER` / `SMTP_PASSWORD` | — | Both optional. Empty user means authentication is skipped entirely, which is what mailpit wants. Never a `smtp://user:pass@host` URL — separate values keep `secretlint` quiet and the password out of a loggable string. |
| `MAIL_FROM` | `Tu Seguridad <no-reply@tu-seguridad.local>` | `From` header, address or `Name <address>` form. |
| `APP_BASE_URL` | `http://localhost:5173` | Origin the emailed links point at — the frontend, not this API. A subpath (`https://host/app`) is preserved. Used by the credential links and by the `/events/:id` link in an alert email. |

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
| [`docs/decisions/`](docs/decisions/) | Decision records. `001` — why snapshot bytes live in MySQL and what replacing that touches. `002` — why live video is RTSP into MediaMTX and HLS out, and how a segment request is authorized. |
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
  - The `call` and `whatsapp` providers. Email ships (see [Alert emails](#alert-emails)); those two channels are still planned-only, and their rows stay `pending` because no code sends them. Each provider ships with its own adapter, not with a shared abstraction invented ahead of it.
  - Alert-email retry and a drain for whatever was `pending` when the process died. Sending is fire-and-forget today.
  - Webhook authentication for `POST /events/acknowledgements`. Still public, and for a provider callback the correlation id is still the only credential — a signature scheme ships with the provider that defines one. The emailed path is not waiting on this: its token is signed, scoped to one delivery, and never logged.
  - A per-event screen in the frontend. The alert mail's *View the alert* button carries the id, and `/events/:id` lands on the history list until one exists.
  - Snapshot retention and the move to object storage ([Snapshot storage](#snapshot-storage)), plus alert-event retention and partitioning.
  - Detection cooldown and deduplication — a camera that keeps seeing someone raises one alert per hysteresis cycle, and nothing suppresses a burst.
  - Poll versus DVR push/WebSocket. Both must drive the same discovery, status and snapshot services; the schema does not pick a winner.
- **04** — Per-track events (`track_id`) once face-auth exposes tracking; `PERSON_UPDATED_IN_ZONE`; movement-vs-presence rules; authorization of known persons; alert schedules.
- DVR snapshot reliability (retries, backoff, reconnection metrics), per-camera FPS tuning, per-camera confidence threshold (today the pipeline uses one `PipelineDefaults.CONFIDENCE_THRESHOLD` for every camera).
