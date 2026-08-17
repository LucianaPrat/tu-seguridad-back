# Conventions

Rules live in `.standards/` (central, submodule) + `AGENTS.md` (repo-specific facts and
declared overrides). This is quick-reference for what is easy to get wrong here, not a
replacement — never restate a central rule in this file.

- Cross-cutting dir is `src/cross/`, not `src/common/` (declared override in `AGENTS.md`).
- Layering check is executable: `grep -rn "PrismaService" src/modules/` must be empty.
  Accessors live in `src/data/accessors/`.
- Error strategy chosen by this repo: `Either<T>` (`src/cross/errors/either.ts`) +
  global `EitherInterceptor`. No `try/catch` in controllers.
- New env var → `EnvNames` (`src/cross/common/constants.ts`) AND Joi schema
  (`src/cross/config/env-validation.schema.ts`) in the same change. `process.env` allowed
  only in `main.ts` and `observability/tracing.ts`.
- `snapshotUrl` may embed DVR basic-auth credentials: never log it, never return it
  outside the single-camera detail `GET`. Check pino redaction + Sentry `beforeSend` when
  adding any path that could surface it.
- New module checklist: `AGENTS.md` §"Adding a new module".
- Branch prefixes are `feat/ fix/ chore/ ...` cut from `develop` (`hotfix/` from `main`) —
  central `GIT.md`. Older branches in flight still use `feature/*` from `main`.
- PR titles/bodies: English, caveman-full. Repo convention, declared in `AGENTS.md`.
- Known jest/tooling gotchas that look like bugs but aren't: `test/jest-int.json`
  `rootDir` resolves relative to the config file's directory (`".."` needed to land at
  repo root); `uuid@14` ships pure ESM, breaks under Jest's default transform — use
  Node's `import { randomUUID } from 'node:crypto'` in test fixtures instead;
  `package.json#prisma` seed block is deprecated (still works) pending migration to
  `prisma.config.ts`.
