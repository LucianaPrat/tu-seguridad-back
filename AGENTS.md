# Project Agent Rules

Central standards apply first. See [`.standards/README.md`](.standards/README.md) for read order and
precedence. This file holds only what is specific to this repository: project facts, the standards
map, declared overrides, and the conventions the central rules leave to the repo.

Nothing here restates a central rule. Found the same rule in both places? That is a bug — delete the
local copy and link to the owner.

## Project facts

- Runtime: Node 22 LTS (`.nvmrc`)
- Package manager: npm
- Framework: NestJS 11 + Express, TypeScript strict
- Database: MySQL 8 (docker container `mysql-local` in dev, **not** a systemd service)
- ORM: Prisma + `@prisma/client`, migrations + seed
- Test runner: Jest, three levels (see [Testing](#testing))
- Deployment target: single host, PM2 fork mode (`ecosystem.config.js`)
- Upstream: face-auth detection API, single tenant — see [`README.md`](README.md)
- Prose language: English for code, comments, commit messages, and documentation. PR titles and
  bodies: English, caveman-full style (terse, no filler, technical substance intact). User-facing
  API copy: English.

Git identity (see [`.standards/standards/GIT.md`](.standards/standards/GIT.md), "Authorship"):

- user.name:  danielfrascarelli
- user.email: dsanfra@gmail.com
- gh account: danielfrascarelli   # pull request author, not checked by git hooks

`gh` may have more than one account logged in, and the GitHub repo's canonical casing is
`LucianaPrat/tu-seguridad-back` — both bite before the first push, see
[`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).

## Applicable standards

- `src/**`, `test/**`, `scripts/**`: NODE, NESTJS
- `prisma/**`: NESTJS
- `openapi.json`: NESTJS, DOCUMENTATION
- `package.json`, `package-lock.json`: DEPENDENCIES
- `.github/**`, `.husky/**`, `ecosystem.config.js`: CHECKS, GIT, DELIVERY
- `*.md`, `docs/**`, `plans/**`: DOCUMENTATION
- Auth, secrets, external input, crypto, wherever they live: SECURITY

## Checks

Names are owned by [`.standards/standards/CHECKS.md`](.standards/standards/CHECKS.md). What this repo
exposes today:

- lint: `npm run lint`
- test: `npm run test:all` — unit + integration + e2e. "Tests pass" never means unit only.
- build: `npm run build`
- format, typecheck, security: **not exposed yet**. Not a declared override, an open gap — see
  [`docs/STANDARDS_GAPS.md`](docs/STANDARDS_GAPS.md). `lint` and `format` also still run in mutating
  mode, so neither is a valid gate until that is fixed.

Audit gate scope, as configured in `.github/workflows/pr-tests.yml`:
`npm audit --omit=dev --audit-level=critical` — production dependencies, critical severity only. Why
that scope and not `--audit-level=high`: [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).

## Workflow: plans

Work here is driven by numbered plans under `plans/` (e.g. `plans/01.setup.md`), executed **in
order**. Each plan has a companion tracker (`plans/01.setup.tasks.md`) recording live status per
task — check the tracker before assuming anything is or is not done, and update it (what was built,
how it was verified) immediately after finishing a task, before moving to the next one.

## Repo-specific hard rules

Everything below is a repo decision the central standards explicitly leave to the repo, or a
project fact no standard can know.

- **Cross-cutting directory is `src/cross/`**, not `src/common/`. See [Overrides](#overrides).
- **Error strategy: typed results.** Services return `Either<T>` (`src/cross/errors/either.ts`),
  controllers return the `Either` as-is, the global `EitherInterceptor` unwraps it into a response or
  throws a mapped `HttpException`. No `try/catch` in controllers. This is the "pick one strategy and
  state it" declaration required by `.standards/stacks/NESTJS.md`.
- **Env access exceptions.** `process.env` may be read only in `main.ts` and
  `src/observability/tracing.ts` — tracing runs before `ConfigModule` exists and loads `dotenv`
  itself. Everywhere else: `ConfigService.get(EnvNames.X)`.
- **`snapshotUrl` is a secret-bearing field.** It may embed DVR basic-auth credentials. Never log it,
  never return it outside the single-camera detail `GET`. A new place that could surface it must be
  checked against `nestjs-pino`'s redaction config, Sentry's `beforeSend` scrub, and every DTO/mapper
  on the path.
- **Accessor layering is verifiable.** `grep -rn "PrismaService" src/modules/` must stay empty.
- **Test database migration.** After `npx prisma migrate dev --name <description>`, apply the same
  migration to the test database: `DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy`.
- **Contract export command.** `npm run openapi:export`, then commit `openapi.json` in the same
  commit as the DTO/route/`@Api*`/versioning change that moved it.
- **Manual smoke check.** After touching anything user-facing in `src/`, prefer a run against the
  real app over trusting the suites alone. Local MySQL/docker setup for that:
  [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).

## Adding a new module

The generic structure, naming, and validation rules are in
[`.standards/stacks/NESTJS.md`](.standards/stacks/NESTJS.md). What is specific here:

1. `src/modules/<name>/` — DTOs, mapper (if it wraps a Prisma model), service, controller, module.
2. Import the accessors the module needs from the global `DataModule`. Never re-declare
   `PrismaService` as a provider outside `src/data/`.
3. Unit spec for the service (mocked accessor) and for the controller (mocked service, asserting
   delegation — `cameras.controller.spec.ts` is the pattern).
4. Wire the module into `AppModule`.
5. If it changes the API surface another module cares about (routes, DTOs, WS events), update the API
   table in [`README.md`](README.md).

## Testing

Suffixes, guards, and harness rules: [`.standards/stacks/NESTJS.md`](.standards/stacks/NESTJS.md),
"Testing". This repo's commands: `npm test`, `npm run test:int`, `npm run test:e2e`,
`npm run test:all`. Integration specs live beside the accessor they test, e2e under `test/`.
Truncation order is FK-safe: `zone_events` → `zones` → `cameras` → `users` → `hits`.

## Agent output style

The `caveman` plugin is on the central allowlist
([`.standards/tooling/PLUGINS.md`](.standards/tooling/PLUGINS.md)). It changes how an agent speaks,
never what gets committed:

- Drop articles, filler, pleasantries, hedging. Fragments fine. Technical terms exact.
- Code, commit messages, and file contents are written normally.
- Drop the style for security warnings and irreversible-action confirmations.

## Overrides

- Replaces stacks/NESTJS.md "src/common/ cross-cutting: guards, interceptors, decorators, config, errors".
  This repo names that directory `src/cross/`.
  Reason: the layout predates the standard, the name is used by every import path in `src/`, and
  renaming it would touch every file for no behavioral gain. The rule itself — one cross-cutting
  directory, importable from anywhere, never imported back into by `data/` — is followed unchanged.

- Replaces standards/GIT.md "Hooks MUST be committed under .githooks/ and installed with git config core.hooksPath .githooks".
  Hooks live under `.husky/`, installed by husky's `prepare` script.
  Reason: `core.hooksPath` accepts one directory, husky already owns it for commitlint and
  lint-staged, and stacks/NESTJS.md requires that husky wiring. The location moves, the enforcement
  does not — the `commit-msg` agent-trailer check and the `pre-push` author check get ported into
  `.husky/`, tracked in [`docs/STANDARDS_GAPS.md`](docs/STANDARDS_GAPS.md) until they land.
