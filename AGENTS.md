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
- Cross-cutting directory: `src/cross/` — guards, interceptors, decorators, config, errors. The
  central standard leaves the name to the repo and requires it be declared here.
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

Names are owned by [`.standards/standards/CHECKS.md`](.standards/standards/CHECKS.md). All six are
exposed:

- format: `npm run format:check` — check-only. `npm run format` is the mutating one.
- lint: `npm run lint` — check-only, `--max-warnings 0`. `npm run lint:fix` is the mutating one, and
  carries `--max-warnings 0` too, so the fix loop and the gate agree on pass/fail.
- typecheck: `npm run typecheck` — `tsc --noEmit --incremental false`, so the check writes no
  `tsbuildinfo` into `dist/`. Runs against `tsconfig.json`, so `test/`, specs,
  `scripts/`, and `prisma/` are typechecked; `npm run build` uses `tsconfig.build.json`, which
  excludes them.
- test: `npm run test:all` — unit + integration + e2e. "Tests pass" never means unit only.
- build: `npm run build`
- security: `npm run security`
  Runs `npm audit --omit=dev --audit-level=critical`, then `secretlint "**/*"`, then exits non-zero if
  either failed. Deliberately not `&&`: CHECKS.md requires both operations to run, and chaining lets a
  red audit skip the secret scan entirely.

Audit gate scope: production dependencies, critical severity only. Why that scope and not
`--audit-level=high`: [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).

Secret scanner: `secretlint` with `@secretlint/secretlint-rule-preset-recommend`, configured in
[`.secretlintrc.json`](.secretlintrc.json). Two things to know before touching it:

- It scans the non-gitignored working tree, not git history. Ignored paths (`.env`, `dist/`,
  `coverage/`) are out of reach by design — nothing there is ever committed. A secret committed and
  later deleted is out of reach too, and that sweep is still open. So is the preset's detection
  surface: it does not recognise this repo's own env-var secret shapes. Both in
  [`docs/STANDARDS_GAPS.md`](docs/STANDARDS_GAPS.md).
- One narrow allow is configured: the fake basic-auth URL `user:pass@dvr.local` used as a fixture in
  `src/observability/sentry.spec.ts`, which tests exactly that `snapshotUrl` gets scrubbed. The allow
  is anchored to that exact host — `user:pass@dvr.local.example.com` and every other basic-auth
  credential still fail the check.

## Workflow: plans

Work here is driven by numbered plans under `plans/` (e.g. `plans/01.setup.md`), executed **in
order**. Each plan has a companion tracker (`plans/01.setup.tasks.md`) recording live status per
task — check the tracker before assuming anything is or is not done, and update it (what was built,
how it was verified) immediately after finishing a task, before moving to the next one.

## Repo-specific hard rules

Everything below is a repo decision the central standards explicitly leave to the repo, or a
project fact no standard can know.

- **Error strategy: typed results.** Services return `Either<T>` (`src/cross/errors/either.ts`),
  controllers return the `Either` as-is, the global `EitherInterceptor` unwraps it into a response or
  throws a mapped `HttpException`. No `try/catch` in controllers. This is the "pick one strategy and
  state it" declaration required by `.standards/stacks/NESTJS.md`.
- **Env access exceptions.** `process.env` may be read only in `main.ts` and
  `src/observability/tracing.ts` — tracing runs before `ConfigModule` exists and loads `dotenv`
  itself. Everywhere else: `ConfigService.get(EnvNames.X)`.
- **Secret-bearing fields live in one list.** `SENSITIVE_FIELD_NAMES`
  (`src/cross/common/sensitive-fields.ts`) is read by both egress channels — `nestjs-pino`'s log
  formatter and Sentry's `beforeSend`/`beforeBreadcrumb`. A new secret-bearing field lands there in
  the same commit that introduces it; two lists drift, and the drift only shows up in production
  logs. What must never leave the process: `Dvr.passwordEncrypted` and the plaintext behind it,
  every `tokenHash`, and the delivery `correlationId` — that last one is the credential
  `POST /events/acknowledgements` accepts, so no response and no message may carry it. The emailed
  acknowledge link carries a token derived from the delivery id instead
  (`src/modules/events/event-ack-token.service.ts`).
- **Snapshot bytes leave the process in exactly one other place.** No API response carries them
  except `GET /snapshots/:id`; a DTO carries the URL, never the bytes. The single exception is the
  inline frame of an alert email, addressed to an opted-in member of the space that owns the camera.
  The frame is the whole point of the notice and a link shows a logged-out recipient nothing, so the
  narrowing is deliberate — see [`ARCHITECTURE.md`](ARCHITECTURE.md), "Outbound mail". Anything else
  that wants the bytes is a bug.
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
Truncation order is FK-safe and owned by one place — `test/utils/truncate-all.ts`. It runs leaves
first: deliveries and alert events, then snapshots, monitor zones, cameras and the DVR, then the
per-space rows (routing, tokens, face identities, invitations, memberships), then spaces, then the
setup-era `hits` rows, and users last. A new table joins that list in the commit that adds it; a
spec that truncates on its own will pass alone and fail in suite order.

## Agent output style

The `caveman` plugin is on the central allowlist
([`.standards/tooling/PLUGINS.md`](.standards/tooling/PLUGINS.md)). It changes how an agent speaks,
never what gets committed:

- Drop articles, filler, pleasantries, hedging. Fragments fine. Technical terms exact.
- Code, commit messages, and file contents are written normally.
- Drop the style for security warnings and irreversible-action confirmations.

## Overrides

- Replaces standards/GIT.md "Hooks MUST be committed under .githooks/ and installed with git config core.hooksPath .githooks".
  Hooks live under `.husky/`, installed by husky's `prepare` script.
  Reason: `core.hooksPath` accepts one directory, husky already owns it for commitlint and
  lint-staged, and stacks/NESTJS.md requires that husky wiring. The location moves, the enforcement
  does not — the `commit-msg` agent-trailer check and the `pre-push` author check get ported into
  `.husky/`, tracked in [`docs/STANDARDS_GAPS.md`](docs/STANDARDS_GAPS.md) until they land.
