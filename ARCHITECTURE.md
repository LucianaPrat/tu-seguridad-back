# Architecture

Plans under [`plans/`](plans/) are the source of truth for what gets built, in order; this doc captures the conventions and decisions learned while implementing them, not a copy of any plan. For the domain model, the current plan is [`03.tenant-alert-data-model`](plans/03.tenant-alert-data-model.md) — it supersedes the setup plan's `User`/`Camera`/`Zone`/`ZoneEvent` shapes wholesale.

## Layering

Layering, accessor isolation, error-strategy, and config rules are central:
[`.standards/stacks/NESTJS.md`](.standards/stacks/NESTJS.md). What this repo picked inside them —
`src/cross/` as the cross-cutting directory, `Either<T>` + `EitherInterceptor` as the error strategy,
and the two files allowed to read `process.env` — is declared in [`AGENTS.md`](AGENTS.md).

This document holds the decisions behind those choices, not a second copy of the rules.

## Data accessor layer

One file per aggregate under `src/data/accessors/`: `user.accessor.ts` → `UserAccessorService`. Fifteen of them today, one per aggregate the tenant model has — user, space, space-member, invitation, auth-token, user-face-identity, dvr, camera, zone (`MonitorZoneAccessorService`), snapshot, alert-routing, alert-event, event-delivery, hit, database-health. All `@Injectable()`, `constructor(private readonly prisma: PrismaService)`, provided and exported by the global `DataModule`, which also exports `PrismaService` itself for the health check and the e2e truncation helper.

Accessors thin. No `Either`, no DTOs, no business rules:
- Plain Prisma calls in, Prisma model types out.
- Prisma **Unchecked** input types (`MonitorZoneUncheckedCreateInput`, `AlertEventUncheckedCreateInput`) so callers pass scalar FKs (`cameraId`) directly instead of `camera: { connect: {...} } }`.
- `HitAccessorService.create()` has no internal try/catch — errors propagate. Fire-and-forget swallowing is caller's job (`HitInterceptor`).

Two rules were added with the tenant model, and both are the reason a service is not allowed to reach Prisma directly (`grep -rn "PrismaService" src/modules/` must stay empty):

- **Tenant scope is a parameter, not a convention.** Every public lookup takes `spaceId` and puts it in its own `where`. A camera, zone or snapshot has no `spaceId` column of its own, so those scope through the relation — `dvr.spaceId`, `camera.dvr.spaceId`. There is no "find by id" that trusts the id alone: a caller cannot forget the scope, because the signature will not compile without it. A row in another space is therefore *not found*, and the service maps that to `404` rather than `403`, since the difference between the two answers confirms the row exists.
- **Deletion is logical, and the predicate is explicit everywhere.** `CameraAccessorService.softDelete()` and the monitor-zone equivalent set `deletedAt`; nothing physically deletes a camera or a zone. Every read — list, detail, count, discovery reconciliation, the poll list, snapshot authorization — carries `deletedAt: null` written out, not hidden behind a Prisma middleware, because the one query that must *not* filter is the alert history, and a global filter would make that exception invisible. The zone FK is `Restrict`, but an `UPDATE` never trips it, so the setup-era `P2003`-on-delete problem no longer exists.

Two accessors carry a transaction because the invariant spans tables and the database cannot express it alone: `DvrAccessorService`'s discovery reconciliation (upsert every discovered channel by `(dvrId, externalId)`, keep the configuration of the ones that matched, mark the vanished ones `isConfigured: false`, never revive a manually deleted camera) and `EventDeliveryAccessorService`'s inbound acknowledgement (claim the delivery on `inboundReceivedAt: null` and acknowledge its event on `acknowledgedAt: null`, so a repeat callback is a no-op and the first responder wins).

## Domain model

`prisma/schema.prisma` is the source of truth for exact fields; [`plans/03.tenant-alert-data-model.md`](plans/03.tenant-alert-data-model.md) §3 is the source of truth for why each relation looks the way it does. The shape in one line: a `Space` is the tenant root, a user belongs to exactly one space through `SpaceMember` (unique on `userId`, so the database enforces it), a space has exactly one `Dvr` (unique on `spaceId`), a DVR owns its discovered `Camera` rows (unique on `(dvrId, externalId)`), and a camera owns percentage-rectangle `MonitorZone` rows. History hangs off the space directly: `AlertEvent` keeps the camera label and alert type copied at detection time and lets its camera/zone/snapshot FKs go `SET NULL`, so a future physical purge cannot erase what happened.

Deviations worth knowing:

- `User.id` and `Hit.id` stayed `Int` while every model introduced by plan 03 uses a UUID `String`. Renumbering users bought nothing and would have churned `hits`, which is technical telemetry and deliberately outside the tenant authorization model.
- `SHADOW_DATABASE_URL` is not in any plan's env list; Prisma needs it for `migrate dev`, and it is validated as optional in the Joi schema.
- One MySQL `CHECK` constraint, `monitor_zones_rectangle_bounds_check`, is hand-written into the migration SQL because Prisma cannot model a cross-column invariant: `x, y >= 0`, `width, height > 0`, `x + width <= 100`, `y + height <= 100`. The service validates the same rules so the API answers a readable `INVALID_ZONE`; the constraint is there for everything that is not the service. Both halves are tested — the DTO path and a raw `INSERT` that MySQL must reject.

## Resilience & observability (plan 02)

Decisions from infra-hardening plan ([`plans/02.infra-hardening.md`](plans/02.infra-hardening.md)). Everything here either always-on-but-passive or **opt-in and a clean no-op when its env var is unset** — never make local dev depend on a new external service. Same posture as `OTEL_ENABLED`.

- **Circuit breaker (opossum).** face-auth upstream is one tenant → **one** in-memory breaker per process, on `FaceAuthClientService`. Breaker action is raw HTTP call that *throws* on failure (public `detectPersons` still returns `Either` and never throws — catches breaker rejection, maps it). Open circuit → `UPSTREAM_ERROR 'face-auth circuit open'`, no call attempted. Breaker global (not per-camera) → state exposed via small `circuitState` getter on service, **not** through per-camera `CameraStatusRegistry` — folding a global signal into per-camera DTO would misrepresent it. No infra dependency (chosen over anything Redis-backed for cost).

- **Error tracking (Sentry).** `initSentry()` runs in `main.ts` **before** `NestFactory.create` (same ordering constraint as `observability/tracing.ts`), gated by `SENTRY_DSN`. `Sentry.captureException` called from one place — `EitherInterceptor`'s `catchError` **unexpected-error** branch (the one producing a 500). Never called for `Either` `ok:false` results or already-mapped `HttpException`s → routine 400/401/404s never reach Sentry. `beforeSend`/`beforeBreadcrumb` scrub and Pino redaction read the *same* list, `SENSITIVE_FIELD_NAMES` (`src/cross/common/sensitive-fields.ts`) — one list, both egress channels, so a new secret-bearing field is covered everywhere in the commit that adds it. Two lists drift, and the drift is only visible in production logs.

- **Health split.** `/health/ready` stays **DB-only** — load-balancer readiness signal, and a degraded upstream must not pull app out of rotation (can still serve camera/zone CRUD). Upstream reachability lives in **separate** `/health/dependencies` (new `FaceAuthHealthIndicator`, same `HealthIndicatorService` shape as `PrismaHealthIndicator`). Both `@Public()` and `VERSION_NEUTRAL`.

- **Graceful shutdown ordering.** `main.ts` calls `enableShutdownHooks()`. Ordered teardown — stop new poll ticks → disconnect WS clients cleanly → disconnect Prisma — via Nest lifecycle hooks (`onModuleDestroy` on `EventsGateway`, `PollingScheduler`, `PrismaService`), **not** custom signal handlers. Nest tears down in reverse init order → feature modules run before shared `DataModule`, the order we want (WS/scheduler before Prisma). In-flight polls allowed to finish; only new ticks stopped.

- **OpenAPI contract artifact.** `openapi.json` at repo root — diffable, committed artifact, generated by `scripts/export-openapi.ts`. Script reuses `buildSwaggerConfig()`/`createOpenApiDocument()` from `src/cross/config/swagger.config.ts` and replicates `main.ts`'s global-prefix + versioning, but **never** calls `app.init()`/`listen()` — needs no DB or network. CI regenerates and `diff`s it; drift fails build. Keep in sync: `npm run openapi:export` after any DTO/route change.

- **Supply-chain gate scope.** The gate is narrowed to production dependencies at **critical**
  severity, which [`.standards/standards/DELIVERY.md`](.standards/standards/DELIVERY.md) permits as
  long as the scope is stated where it is configured. Why this scope and not `--audit-level=high`:
  [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).

## Testing layers

- **Unit** (`*.spec.ts`): root jest config, `testRegex: ".*\\.spec\\.ts$"`. Does NOT match `*.int-spec.ts` (different suffix shape: `-spec` not `.spec`) — no DB, no network.
- **Integration** (`*.int-spec.ts`): own config `test/jest-int.json`, run via `npm run test:int`. Hits REAL local `DATABASE_URL_TEST` database. Colocated next to accessor they test (`src/data/accessors/*.int-spec.ts`), not under `test/`.
  - Safety doubled on purpose: `test/setup-int-env.ts` (Jest `setupFiles`) forces `process.env.DATABASE_URL = process.env.DATABASE_URL_TEST` and throws if `DATABASE_URL_TEST` looks wrong; EVERY spec additionally builds its own client with `new PrismaService({ datasourceUrl: process.env.DATABASE_URL_TEST })`. Never rely on ambient `.env` alone in an int-spec — a bug there means truncating DEV database.
  - `beforeEach` truncates through `test/utils/truncate-all.ts`, the single owner of the FK-safe order — leaves first (deliveries, alert events, snapshots, monitor zones, cameras, DVR), then the per-space rows, then spaces, users last. Specs do not hand-roll their own delete order; one that does passes alone and fails in suite order.
  - Specs bypass Nest DI — plain `new XAccessorService(prisma)`, manual `$connect`/`$disconnect` in `beforeAll`/`afterAll`.
- **E2E** (`*.e2e-spec.ts`, `test/`): own config `test/jest-e2e.json`, run via `npm run test:e2e`. Boots real `AppModule` (HTTP + WebSocket), same test database as int-specs. `test/utils/bootstrap-e2e-app.ts` replicates every piece of `main.ts`'s bootstrap that only lives on `INestApplication` instance — global prefix, versioning, validation pipe, Swagger setup — none of that comes free from `AppModule` alone; skip any and routes silently 404 or land at wrong path. Three ports are overridden with fakes in `test/utils/bootstrap-e2e-app.ts` — `FaceAuthClientService`, `DvrClientPort` and `CredentialDeliveryPort` — so e2e needs no detection upstream, no recorder on the network and no mail relay, and a spec can read the one-time token a real invitee would receive by mail. `ensureAdminSeeded` builds the whole tenant graph (account, space, owner membership, routing defaults), because a bare user is exactly what the login gate rejects: a fixture that inserted one would fail at login instead of at the assertion under test.
- `test:int` stayed wired through `test/jest-int.json` (env-guard config) rather than simplified inline `--testRegex` form from original plan text — that form skips test-DB safety guard (`process.env.DATABASE_URL = process.env.DATABASE_URL_TEST`) entirely.

## Infra

MySQL runs in docker container (`mysql-local`, port-mapped to `127.0.0.1:3306`) in this dev setup, not a systemd service. `docker ps` to check it, not `systemctl`.

More tooling/ops gotchas (not architecture, but learned building this): [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).
