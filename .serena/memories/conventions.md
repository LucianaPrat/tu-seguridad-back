# Conventions

Full hard-rule list lives in `AGENT.md` — this is quick-reference, not a replacement.

- Layering: `modules → data (accessors) → Prisma`. Feature modules never inject
  `PrismaService` directly, always through an accessor in `src/data/accessors/`.
  Verify with `grep -rn "PrismaService" src/modules/` (must be empty).
- Error handling: services return `Either<T>` (`src/cross/errors/either.ts`), not
  exceptions. Controllers return the `Either` as-is; global `EitherInterceptor` unwraps
  or throws the mapped `HttpException`. No `try/catch` in controllers, no custom
  `ExceptionFilter`s.
- Env access: only `ConfigService.get(EnvNames.X)`. Never `process.env` directly except
  `main.ts` / `observability/tracing.ts` (must run before `ConfigModule` exists). New
  env var → add to `EnvNames` (`src/cross/common/constants.ts`) AND the Joi schema
  (`src/cross/config/env-validation.schema.ts`) in the same change, never just one.
- Test file suffixes: `*.spec.ts` (unit, no I/O), `*.int-spec.ts` (real test DB,
  colocated next to what it tests), `*.e2e-spec.ts` (full app boot, under `test/`).
- New module checklist (see `AGENT.md` §"Adding a new module" for full steps): DTOs +
  mapper + `Either`-returning service + controller + module under `src/modules/<name>/`;
  import accessors from `DataModule`, don't redeclare `PrismaService`; `@ApiTags` /
  `@ApiBearerAuth()` on protected controllers; unit specs for service (mocked accessor)
  and controller (mocked service, asserts delegation — pattern in
  `cameras.controller.spec.ts`); wire into `AppModule`; update API table in `README.md`
  if routes/DTOs/WS events change externally.
- Commits: Conventional Commits, one logical change per commit, English only, no
  AI-agent trace anywhere (enforced — see `CONTRIBUTING.md`). PR descriptions on this
  repo are written caveman-full style — a session-level convention, not a tool default.
- Branch model: `main` = production (never a direct feature-branch target); `develop` =
  integration; `feature/*`/`fix/*`/`chore/*` cut from `main`, PR target always `develop`.
- Known jest/tooling gotchas that look like bugs but aren't: `test/jest-int.json`
  `rootDir` resolves relative to the config file's directory (`".."` needed to land at
  repo root); `uuid@14` ships pure ESM, breaks under Jest's default transform — use
  Node's `import { randomUUID } from 'node:crypto'` in test fixtures instead;
  `package.json#prisma` seed block is deprecated (still works) pending migration to
  `prisma.config.ts`.
