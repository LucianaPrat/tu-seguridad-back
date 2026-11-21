# Standards gaps

Where this repo does not yet satisfy [`.standards/`](../.standards/README.md). These are **not**
declared overrides — an override says "we deliberately do it differently and here is why", and a gap
says "the rule applies, we do not meet it yet". Declared overrides live in
[`AGENTS.md`](../AGENTS.md), and nothing in this file belongs there.

Rule of thumb: an entry leaves this file by being fixed, or by being promoted to an override with a
written reason. It does not leave by being forgotten.

## Checks and gates

| Gap | Rule | Fix |
|---|---|---|
| `security` scans the working tree only, not git history | CHECKS.md "the security check", SECURITY.md | `secretlint` reads files as they are now, so a secret committed and later removed stays invisible to it. One-off sweep of the 102 commits with `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --redact`, then decide whether it stays a periodic job |
| `security` secret scan does not recognise this repo's own secret shapes | CHECKS.md "the security check", SECURITY.md | `@secretlint/secretlint-rule-preset-recommend` catches DSNs and vendor-format keys, but a bare `JWT_SECRET`, `JWT_REFRESH_SECRET`, `ADMIN_PASSWORD`, `FACE_AUTH_TOKEN`, or `DVR_PASSWORD_ENCRYPTION_KEY` value pasted into a fixture or a docs snippet passes clean. Add `@secretlint/secretlint-rule-pattern` entries keyed on those names, tuned so `.env.example` placeholders and the CI `env:` block do not fire |
| `coverageThreshold` (`lines: 80`) is a gate no CI step can fire | DELIVERY.md "coverage MUST be measured by a command CI actually executes" | CI runs `npm run test:all`, which passes `--coverage` nowhere, so line coverage can fall to anything and stay green. Measured unit coverage is 77.2%: raise it over 80% first, then switch the unit leg of `test:all` to `npm run test:cov` |
| No CI check of the PR title/body for agent traces | GIT.md, "No agent traces" — a git hook cannot see a PR body | wire `.standards/scripts/check-pr-body.sh` into the workflow |
| No `validate-standards` workflow, and `pr-tests.yml` checks out without `submodules: true`, so `.standards/` is empty in CI | central README.md, "Option C, CI validation" | copy `.standards/docs/examples/validate-consumer-standards.yml` into `.github/workflows/`; it also carries the PR-body check above |
| `commit-msg` agent-trailer check and `pre-push` author check not installed | GIT.md, "Enforcement" | port `.standards/scripts/hooks/` logic into `.husky/` (see the hooks override in `AGENTS.md`) |

## Lint and types

| Gap | Rule |
|---|---|
| `@typescript-eslint/no-explicit-any` is `off` | NESTJS.md — MUST stay enabled, each `any` needs an inline disable naming the reason |
| `no-floating-promises` and `no-unsafe-argument` are `warn` | NESTJS.md — both MUST be errors |
| `tsconfig.json` lacks `noUncheckedIndexedAccess` and `noImplicitOverride` | NESTJS.md — both MUST be enabled |
| `package.json` has no `engines.node` and no `packageManager` | NODE.md — the version MUST be pinned in every place that selects it, and all of them MUST agree with `.nvmrc` |
| No `paths` aliases in `tsconfig.json`, none mirrored in the Jest `moduleNameMapper`, and 53 imports in `src/` climb two or more directories | NESTJS.md — aliases MUST be declared and mirrored, and a relative import climbing more than one directory MUST NOT be used |

## Application

| Gap | Rule |
|---|---|
| `/health/ready` and `/health/dependencies` are `@Public()` | NESTJS.md — only `/health/live` MAY be public; the other two name upstreams and their state to any caller and MUST be reachable only by orchestration |
| No global exception filter alongside the `EitherInterceptor` | NESTJS.md — guards and pipes run before interceptors, so a guard rejection currently escapes with the framework's default body, giving the API two error shapes on one route |
| Two logger injection styles coexist (`new Logger(Class.name)` and injected `PinoLogger`) | NESTJS.md — one style per repo, and the README MUST say which |
| No shared `configureApp(app)`. `main.ts`, `scripts/export-openapi.ts`, and `test/utils/bootstrap-e2e-app.ts` each replay the bootstrap separately | NESTJS.md — one exported `configureApp(app)` MUST be shared by all three, or prefix/versioning drift shows up as tests asserting a shape production never emits |
| No `CODEOWNERS`, no pull request template | PR.md — approvals and the canonical description fields reference both |

## Repository

| Gap | Rule |
|---|---|
| Branch names in flight still use `feature/*` cut from `main` | GIT.md — prefix is `feat/`, and feature work branches off `develop`. New branches follow the standard; the open stack is not renamed |
