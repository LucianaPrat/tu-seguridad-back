# Architecture

Source of truth for the full plan: [`plans/01.setup.md`](plans/01.setup.md). This doc captures conventions + decisions learned while implementing it, not a copy of the plan.

## Layering (hard rule)

`modules → data (accessors) → Prisma`. `cross` usable everywhere. Feature modules NEVER inject `PrismaService` directly — always through an accessor. Enforce with `grep -rn "PrismaService" src/modules/` → must stay empty.

Services return `Either<T>` (`src/cross/errors/either.ts`), controllers return the Either, global `EitherInterceptor` unwraps it. No `try/catch` in controllers, no ExceptionFilters.

Env access only via `ConfigService.get(EnvNames.X)`, never `process.env` outside bootstrap/tracing.

## Data accessor layer (T08)

One file per aggregate under `src/data/accessors/`: `user.accessor.ts` → `UserAccessorService`, same pattern for `camera`, `zone`, `zone-event`, `hit`. All `@Injectable()`, `constructor(private readonly prisma: PrismaService)`, exported by the global `DataModule` (which also exports `PrismaService` itself — needed by future health-check + e2e-truncate code).

Accessors are thin. No `Either`, no DTOs, no business rules:
- Plain Prisma calls in, Prisma model types out.
- Prisma **Unchecked** input types (`ZoneUncheckedCreateInput`, `ZoneEventUncheckedCreateInput`) so callers pass scalar FKs (`cameraId`) directly instead of `camera: { connect: {...} } }`.
- `CameraAccessorService.delete()` is a plain passthrough — it does NOT pre-check zones. `Zone.cameraId` is `onDelete: Restrict`, so deleting a camera with zones throws a Prisma `P2003` at the DB level. `countZones()` exists so the future service layer can pre-check and return a clean `409 CONFLICT` instead of leaking the DB error. Business rule lives in the service, not the accessor.
- `ZoneEventAccessorService.query()` applies `take: filter.limit` as given — it does NOT clamp to a max. Default-100/max-1000 clamping is a future `EventsService` (T13) responsibility.
- `HitAccessorService.create()` has no internal try/catch — errors propagate. Fire-and-forget swallowing is the caller's job (T17 `HitInterceptor`).

## Domain model

`schema.prisma` is the source of truth for exact fields. One deviation from the plan's env-var list (§6): `SHADOW_DATABASE_URL` was added for Prisma's shadow database during `migrate dev` — validated as optional in the Joi schema, not in the original plan text.

## Resilience & observability (plan 02)

Decisions from the infra-hardening plan ([`plans/02.infra-hardening.md`](plans/02.infra-hardening.md)). Everything here is either always-on-but-passive or **opt-in and a clean no-op when its env var is unset** — never make local dev depend on a new external service. Same posture as `OTEL_ENABLED`.

- **Circuit breaker (opossum).** The face-auth upstream is a single tenant, so there is exactly **one** in-memory breaker per process, held on `FaceAuthClientService`. The breaker action is the raw HTTP call that *throws* on failure (the public `detectPersons` still returns `Either` and never throws — it catches the breaker rejection and maps it). Open circuit → `UPSTREAM_ERROR 'face-auth circuit open'`, no call attempted. Because the breaker is global (not per-camera), its state is exposed via a small `circuitState` getter on the service, **not** through the per-camera `CameraStatusRegistry` — folding a global signal into a per-camera DTO would misrepresent it. No infra dependency (chosen over anything Redis-backed for cost).

- **Error tracking (Sentry).** `initSentry()` runs in `main.ts` **before** `NestFactory.create` (same ordering constraint as `observability/tracing.ts`), gated by `SENTRY_DSN`. `Sentry.captureException` is called from exactly one place — the `EitherInterceptor`'s `catchError` **unexpected-error** branch (the one that produces a 500). It is never called for `Either` `ok:false` results or already-mapped `HttpException`s, so routine 400/401/404s never reach Sentry. A `beforeSend`/`beforeBreadcrumb` scrub mirrors the Pino redaction (`snapshotUrl`, `Authorization`, `Fa-Token`) so secrets never leave the process.

- **Health split.** `/health/ready` stays **DB-only** — it is the load-balancer readiness signal, and a degraded upstream must not pull the app out of rotation (it can still serve camera/zone CRUD). Upstream reachability lives in a **separate** `/health/dependencies` (new `FaceAuthHealthIndicator`, same `HealthIndicatorService` shape as `PrismaHealthIndicator`). Both are `@Public()` and `VERSION_NEUTRAL`.

- **Graceful shutdown ordering.** `main.ts` already calls `enableShutdownHooks()`. The ordered teardown — stop new poll ticks → disconnect WS clients cleanly → disconnect Prisma — is achieved through Nest lifecycle hooks (`onModuleDestroy` on `EventsGateway`, `PollingScheduler`, `PrismaService`), **not** custom signal handlers. Nest tears down in reverse init order, so feature modules run before the shared `DataModule`, which is exactly the order we want (WS/scheduler before Prisma). In-flight polls are allowed to finish; only new ticks are stopped.

- **OpenAPI contract artifact.** `openapi.json` at the repo root is a diffable, committed artifact, generated by `scripts/export-openapi.ts`. The script reuses `buildSwaggerConfig()`/`createOpenApiDocument()` from `src/cross/config/swagger.config.ts` and replicates `main.ts`'s global-prefix + versioning, but **never** calls `app.init()`/`listen()` — so it needs no DB or network. CI regenerates and `diff`s it; drift fails the build. Keep it in sync: `npm run openapi:export` after any DTO/route change.

- **Supply-chain gate.** CI runs `npm audit --omit=dev --audit-level=critical` — production deps only (dev tooling never ships), blocking on **critical** severity. High transitive advisories are handled by Dependabot's weekly grouped PRs to `develop`, not by hard-failing every unrelated PR. Rationale in [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).

## Testing layers

- **Unit** (`*.spec.ts`): root jest config, `testRegex: ".*\\.spec\\.ts$"`. Deliberately does NOT match `*.int-spec.ts` (different suffix shape: `-spec` not `.spec`) — no DB, no network.
- **Integration** (`*.int-spec.ts`): own config `test/jest-int.json`, run via `npm run test:int`. Hits the REAL local `DATABASE_URL_TEST` database. Colocated next to the accessor they test (`src/data/accessors/*.int-spec.ts`), not under `test/`.
  - Safety is doubled on purpose: `test/setup-int-env.ts` (Jest `setupFiles`) forces `process.env.DATABASE_URL = process.env.DATABASE_URL_TEST` and throws if `DATABASE_URL_TEST` looks wrong; EVERY spec additionally builds its own client with `new PrismaService({ datasourceUrl: process.env.DATABASE_URL_TEST })`. Never rely on ambient `.env` alone in an int-spec — a bug there means truncating the DEV database.
  - `beforeEach` truncates in FK-safe order: `zone_events` → `zones` → `cameras` → `users` → `hits`.
  - Specs bypass Nest DI — plain `new XAccessorService(prisma)`, manual `$connect`/`$disconnect` in `beforeAll`/`afterAll`.
- **E2E** (`*.e2e-spec.ts`, `test/`): own config `test/jest-e2e.json`, run via `npm run test:e2e`. Boots the real `AppModule` (HTTP + WebSocket), same test database as int-specs. `test/utils/bootstrap-e2e-app.ts` replicates every piece of `main.ts`'s bootstrap that only lives on the `INestApplication` instance — global prefix, versioning, validation pipe, Swagger setup — since none of that comes for free from `AppModule` alone; skip any of it and routes silently 404 or land at the wrong path. `FaceAuthClientService` is overridden with a fake (`test/utils/bootstrap-e2e-app.ts`) — no real upstream calls in e2e.
- `test:int` stayed wired through `test/jest-int.json` (the env-guard config) rather than the simplified inline `--testRegex` form from the original plan text — that form skips the test-DB safety guard (`process.env.DATABASE_URL = process.env.DATABASE_URL_TEST`) entirely.

## Infra

MySQL runs in a docker container (`mysql-local`, port-mapped to `127.0.0.1:3306`) in this dev setup, not a systemd service. `docker ps` to check it, not `systemctl`.

More tooling/ops gotchas (not architecture, but learned building this): [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).
