# AGENT.md

Conventions for AI coding agents in this repo, tool-agnostic. Reasoning behind each rule lives in [`ARCHITECTURE.md`](ARCHITECTURE.md) — read that first if something here seems arbitrary.

## Workflow: plans

Work in this repo driven by numbered plans under `plans/` (e.g. `plans/01.setup.md`), executed **in order**. Each plan has companion tracker (`plans/01.setup.tasks.md`) recording live status per task — check tracker before assuming anything is or isn't done, update it (what built, how verified) immediately after finishing a task, before moving to next one.

## Hard rules

- **Layering**: `modules → data (accessors) → Prisma`. `cross/` usable everywhere. Feature modules never inject `PrismaService` directly — always through accessor. Verify with `grep -rn "PrismaService" src/modules/` → must be empty.
- **Either, not exceptions**: services return `Either<T>` (`src/cross/errors/either.ts`); controllers return `Either` as-is; global `EitherInterceptor` unwraps it into response or throws mapped `HttpException`. No `try/catch` in controllers, no custom `ExceptionFilter`s.
- **Env access**: only via `ConfigService.get(EnvNames.X)`. Never `process.env` directly, except inside `main.ts`/`observability/tracing.ts` (tracing runs before `ConfigModule` exists → loads `dotenv` itself). Add new vars to `EnvNames` (`src/cross/common/constants.ts`) and Joi schema (`src/cross/config/env-validation.schema.ts`) together, never one without the other.
- **Test suffixes**: `*.spec.ts` (unit, no I/O), `*.int-spec.ts` (real test DB, colocated next to what it tests), `*.e2e-spec.ts` (full app boot, lives under `test/`). Run `npm run test:all` before considering any task finished — unit-only passing not enough.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `ci:`), one logical change per commit, no AI-agent trace anywhere (see [`CONTRIBUTING.md`](CONTRIBUTING.md) — enforced, not a suggestion).
- **Never commit secrets.** `.env` is gitignored — if a real credential about to land in a diff, stop and flag it instead of committing. Never log or return `snapshotUrl` outside single-camera detail `GET` (may embed DVR basic-auth credentials) — check `nestjs-pino`'s redaction config and each DTO/mapper before adding a new place that could leak it.

## Adding a new module

1. `src/modules/<name>/` — DTOs, mapper (if wraps a Prisma model), service (`Either`-returning), controller, module.
2. Feature module imports whatever accessors it needs from global `DataModule` — don't re-declare `PrismaService` as a provider anywhere outside `data/`.
3. `@ApiTags`, `@ApiBearerAuth()` on protected controllers; `@ApiConsumes`/`@ApiBody` for any multipart route.
4. Unit spec for service (mocked accessor), unit spec for controller (mocked service, asserts delegation — see `cameras.controller.spec.ts` for pattern).
5. Wire module into `AppModule`.
6. If it changes API surface in a way another module cares about (routes, DTOs, WS events), update API table in `README.md`.

## Infra integrations (plan 02)

Merged infra frameworks and rules for touching them. Full rationale in [`ARCHITECTURE.md`](ARCHITECTURE.md) → *Resilience & observability*; framework map in `README.md` → *Observability, resilience & supply chain*.

- **OpenAPI contract is a committed artifact.** After ANY change to a DTO, controller route, `@Api*` decorator, or versioning, run `npm run openapi:export` and commit updated `openapi.json` **in the same commit**. CI regenerates and `diff`s it — a stale file fails build. Export needs no DB/network (never calls `app.listen()`).
- **Opt-in integrations must no-op when their env var is unset.** Sentry (`SENTRY_DSN`), OTel (`OTEL_ENABLED`), and any future metrics/token gate follow this. Never make local dev, tests, or CI require a new external service. Mirror `stringRequiredInProduction` in Joi schema when a var must be required in prod but optional in dev.
- **Sentry only reports unexpected errors.** Report new failure signals through existing `EitherInterceptor` unexpected-500 path — never call `Sentry.captureException` for `Either` failures or `HttpException`s, and add any new sensitive field to both Pino redaction list and Sentry `beforeSend` scrub.
- **face-auth calls go through the `opossum` circuit breaker.** Don't add a second raw path to upstream that bypasses it. Breaker is global (one upstream); expose breaker-adjacent state on service, not per-camera `CameraStatusRegistry`.
- **Health checks: keep `/health/ready` DB-only.** New external-dependency reachability checks go in `/health/dependencies` (add a Terminus indicator) → degraded dependency never marks whole app not-ready.
- **CI supply-chain gate.** `npm audit --omit=dev --audit-level=critical` runs on every PR. A new **production** dependency carrying a critical advisory blocks merge — pick a patched version or different dependency; don't silence gate.

## Prisma migrations

Schema change → `npx prisma migrate dev --name <description>` (applies to `DATABASE_URL`, generates migration) → commit new file under `prisma/migrations/` alongside schema change, same commit. Then apply same migration to test database: `DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy`. Never edit a migration file already applied anywhere — add a new one.

## Before finishing a task

- `npm run build && npm run lint && npm run test:all` all clean.
- If you changed any DTO/route/`@Api*` decorator: `npm run openapi:export` and commit updated `openapi.json` (CI diff-checks it).
- If you touched anything in `src/`, prefer a manual smoke check against real running app over trusting tests alone for anything user-facing (see [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md) for local MySQL/docker setup this needs).
