# AGENT.md

Conventions for AI coding agents working in this repo, tool-agnostic. The reasoning behind each rule lives in [`ARCHITECTURE.md`](ARCHITECTURE.md) — read that first if something here seems arbitrary.

## Workflow: plans

Work in this repo is driven by numbered plans under `plans/` (e.g. `plans/01.setup.md`), executed **in order**. Each plan has a companion tracker (`plans/01.setup.tasks.md`) recording live status per task — check the tracker before assuming anything is or isn't done, and update it (what was built, how it was verified) immediately after finishing a task, before moving to the next one.

## Hard rules

- **Layering**: `modules → data (accessors) → Prisma`. `cross/` is usable everywhere. Feature modules never inject `PrismaService` directly — always through an accessor. Verify with `grep -rn "PrismaService" src/modules/` → must be empty.
- **Either, not exceptions**: services return `Either<T>` (`src/cross/errors/either.ts`); controllers return the `Either` as-is; the global `EitherInterceptor` unwraps it into the response or throws the mapped `HttpException`. No `try/catch` in controllers, no custom `ExceptionFilter`s.
- **Env access**: only via `ConfigService.get(EnvNames.X)`. Never `process.env` directly, except inside `main.ts`/`observability/tracing.ts` (tracing has to run before `ConfigModule` exists, so it loads `dotenv` itself). Add new vars to `EnvNames` (`src/cross/common/constants.ts`) and the Joi schema (`src/cross/config/env-validation.schema.ts`) together, never one without the other.
- **Test suffixes**: `*.spec.ts` (unit, no I/O), `*.int-spec.ts` (real test DB, colocated next to what it tests), `*.e2e-spec.ts` (full app boot, lives under `test/`). Run `npm run test:all` before considering any task finished — unit-only passing is not enough.
- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `ci:`), one logical change per commit, no AI-agent trace anywhere (see [`CONTRIBUTING.md`](CONTRIBUTING.md) — this is enforced, not a suggestion).
- **Never commit secrets.** `.env` is gitignored — if a real credential is about to land in a diff, stop and flag it instead of committing. Never log or return `snapshotUrl` outside the single-camera detail `GET` (it may embed DVR basic-auth credentials) — check `nestjs-pino`'s redaction config and each DTO/mapper before adding a new place that could leak it.

## Adding a new module

1. `src/modules/<name>/` — DTOs, mapper (if it wraps a Prisma model), service (`Either`-returning), controller, module.
2. Feature module imports whatever accessors it needs from the global `DataModule` — don't re-declare `PrismaService` as a provider anywhere outside `data/`.
3. `@ApiTags`, `@ApiBearerAuth()` on protected controllers; `@ApiConsumes`/`@ApiBody` for any multipart route.
4. Unit spec for the service (mocked accessor), unit spec for the controller (mocked service, asserts delegation — see `cameras.controller.spec.ts` for the pattern).
5. Wire the module into `AppModule`.
6. If it changes API surface in a way another module cares about (routes, DTOs, WS events), update the API table in `README.md`.

## Prisma migrations

Schema change → `npx prisma migrate dev --name <description>` (applies to `DATABASE_URL`, generates the migration) → commit the new file under `prisma/migrations/` alongside the schema change, same commit. Then apply the same migration to the test database: `DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy`. Never edit a migration file that's already been applied anywhere — add a new one.

## Before finishing a task

- `npm run build && npm run lint && npm run test:all` all clean.
- If you touched anything in `src/`, prefer a manual smoke check against the real running app over trusting tests alone for anything user-facing (see [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md) for the local MySQL/docker setup this needs).
