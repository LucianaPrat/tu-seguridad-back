# Best practices / gotchas

Ops + tooling lessons from building this repo. Not architecture (see [`ARCHITECTURE.md`](../ARCHITECTURE.md)), not rules — those are central, [`.standards/`](../.standards/README.md), with the repo's own facts and overrides in [`AGENTS.md`](../AGENTS.md). This file is "learned it the hard way once, write it down so nobody repeats it."

## git / gh

- `gh` may have multiple accounts logged in. Check push access BEFORE assuming: `gh repo view LucianaPrat/tu-seguridad-back --json viewerPermission`. If it says `READ`, switch: `gh auth switch --user danielfrascarelli`.
- GitHub repo canonical casing is `LucianaPrat/tu-seguridad-back` (capital L/P) — `gh api`-backed commands (`gh repo view`, `gh repo edit`) need exact case or 404. Plain `git push`/`git clone` over https redirect fine either way.
- A new clone or worktree starts with an empty `.standards/`. Run `git submodule update --init` before relying on any central rule.
- git worktrees (`git worktree add`) only check out committed history. Untracked files — `.env`, any in-progress uncommitted work — do NOT come along, and repo-level `git config` (the identity declared in [`AGENTS.md`](../AGENTS.md)) does not either. Copy `.env` in and verify the identity before running anything.

## Prisma / jest

- `test/jest-int.json` `rootDir` resolves relative to the **directory containing the config file**, not process CWD. A config living in `test/` with `rootDir: "."` resolves to `test/`, not repo root — breaks `setupFiles` paths and test glob. Use `rootDir: ".."` from `test/jest-int.json` to land back at repo root.
- `uuid@14`'s `dist-node` build ships pure ESM (`export {...}`). Jest's default transform doesn't touch `node_modules` → `import { v4 } from 'uuid'` in a spec throws `SyntaxError: Unexpected token 'export'`. Use Node's built-in `import { randomUUID } from 'node:crypto'` for test fixture IDs instead — no config change needed.
- `package.json#prisma` (the `"prisma": { "seed": ... }` block) deprecated, warns on every Prisma CLI call. Works fine today; migrate to `prisma.config.ts` eventually, not urgent.
- VS Code Prisma extension flags `datasource db { url, shadowDatabaseUrl }` in `schema.prisma` as deprecated (bundled language server validates ahead against Prisma 7 rules, even though installed CLI is `6.19.3` and still supports inline `url`/`shadowDatabaseUrl` today). Prisma 7 splits this in two: Migrate's connection URL moves to `prisma.config.ts`; `PrismaClient` (`src/data/prisma/prisma.service.ts`) stops reading `DATABASE_URL` implicitly, instead takes an `adapter` (direct connection) or `accelerateUrl` in its constructor. Not urgent — revisit when bumping to Prisma 7, confirm exact `defineConfig`/adapter API at that time rather than guessing now.
- MySQL in dev runs as docker container (`mysql-local`), NOT a systemd service. Don't waste a step on `systemctl start mysql`.

## Mail (local)

- Dev SMTP is a plain container, same as MySQL — it needs nothing from the repo's compose file, which
  only owns the MediaMTX sidecar:
  `docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit`. Web UI on
  <http://localhost:8025>, SMTP on `1025`, no authentication. Then set `MAIL_ENABLED=true` in `.env`;
  the other mail defaults already point at it. That one switch also turns on alert emails, so a
  detection with `email` enabled in the routing matrix lands in the same inbox. Cleanup:
  `docker stop mailpit && docker rm mailpit`.
- Mailpit **catches** mail, it never delivers it. To land a message in a real Gmail inbox, point the
  same code at Google — no code change, four variables: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`,
  `SMTP_USER=<your gmail address>`, `SMTP_PASSWORD=<16-char App Password>`.

  An App Password is not the account password. It requires 2-Step Verification on the Google account,
  is generated and revoked at <https://myaccount.google.com/apppasswords>, and grants mail-send on
  that account to whoever holds it. It belongs in the gitignored `.env` and nowhere else — not in
  `.env.example`, not in a commit, not in a PR description. Gmail also caps sends at roughly 500/day,
  which is a testing tool, not a delivery channel.
- `MAIL_ENABLED=true` in a developer `.env` used to be enough to make `npm run test:e2e` send real
  mail: `test/setup-e2e-env.ts` loads `dotenv/config`, and the e2e harness overrides
  `FaceAuthClientService` and `DvrClientPort` but not `CredentialDeliveryPort`. That setup file now
  forces the switch off. Any new harness that boots `AuthModule` must do the same.

## Frame annotation

- **The confidence tag needs a font on the host.** `sharp` composites the detection boxes from an
  SVG, and the `%` label inside it is rendered by librsvg through fontconfig — which uses the
  *host's* fonts, not something the package ships. A deploy target with no font packages installed
  draws the green box and the filled tag and leaves the tag empty. `fc-list | head` on the host says
  whether there is anything to render with; `fonts-dejavu-core` is enough. The failure is silent and
  only visible in the delivered mail, which is why the label sits on a filled rectangle: an empty
  tag still marks the detection.
- **Re-encoding changes the frame size.** The annotated JPEG is written at quality 88 and typically
  lands within ~20% of the captured bytes, but it can grow. A frame that was just under
  `SNAPSHOT_MAX_BYTES` can be refused after annotation; the pipeline retries that write with the
  frame as captured rather than dropping the evidence.

## Observability (local)

- Traces need a collector listening, and there is no container for it: it is a PM2 process from
  [`ops/otel-collector/`](../ops/otel-collector/README.md). `scripts/install.sh` once, then a `.env`
  with `OTELCOL_MODE=debug`, then `scripts/start.sh`. Debug mode prints every span with
  `verbosity: detailed` **and** ships it to Grafana Cloud, so `pm2 logs
  tu-seguridad-otel-collector` is the whole tool for reading one trace. `OTELCOL_MODE=test` needs no
  Grafana credentials at all.
- **`OTEL_ENABLED=true` in the app's `.env` is the other half.** With the collector up and the switch
  off, or the switch on and no collector, nothing arrives — and the second case looks worse than it
  is: the OTLP exporter retries and fills the log with export failures. `scripts/check-health.sh`
  checks both halves.
- **Quote the Grafana auth header** in the collector's `.env`:
  `GRAFANA_CLOUD_OTLP_AUTH_HEADER="Basic <base64>"`. The scripts `source` that file, so the space in
  `Basic <base64>` unquoted assigns `Basic` and then tries to run the base64 as a command. The error
  it produces names the variable as missing, which points nowhere near the quoting.
- The face-api collector on this machine listens on the same `127.0.0.1:4318`. Two collectors cannot
  both bind it, and they do not need to: in dev, whichever one is up serves both APIs, and
  `service.name` keeps the two services apart in Grafana. In prod they are different hosts, which is
  why this repo has an instance of its own.

## Infra / CI (plan 02)

- **`npm audit` gate scope.** CI runs `npm audit --omit=dev --audit-level=critical`, not `--audit-level=high` on the full tree. Advisory DB updates constantly → full-tree `high` gate turns red on unrelated PRs the moment a new transitive advisory lands (it happened — 30 new `high`s, all dev tooling + transitive prod, 0 critical, appeared days after a green run). Dev-tooling vulns (jest/babel/etc.) never ship; high transitive prod advisories are Dependabot's job. Gate blocks only production-dependency **critical** severity. If it ever fires, fix the dep — don't widen `--audit-level` or `|| true` it.
- **The three `high` advisories the gate lets through, and why they stay.** `npm audit fix` cleared the `brace-expansion` and `js-yaml` ones (the second reached through `@nestjs/swagger`, which now resolves `js-yaml@4`). What is left is one advisory counted three times: `deepmerge-ts` stack exhaustion, reached through `@prisma/config` and `prisma`, which `@prisma/client` depends on — so it is in the production tree even though the CLI is not loaded by the running server. The only offered fix is `npm audit fix --force`, which **downgrades** `prisma` from 6.19.3 to 6.12.0; that is a worse tree, not a safer one. The vulnerable path merges Prisma's own config files, which this repo authors — nothing an attacker supplies reaches it. Re-check on the next Prisma minor; do not downgrade, and do not widen the gate to make it visible.
- **OpenAPI export replicates `main.ts` by hand.** `scripts/export-openapi.ts` re-implements `main.ts`'s `setGlobalPrefix(... exclude ...)` + `enableVersioning(...)`. Change prefix/versioning/excludes in one and not the other → `openapi.json` drifts from `/docs-json` and CI's diff check fails. (The standard's fix for this class of bug is a single shared `configureApp(app)`; this repo has not extracted one yet.)
- **Stacked-PR CI can show stale red.** Reopening a PR (or force-pushing while its base branch changed) can leave `gh pr checks` pointing at an old run computed on a **stale merge-ref** — e.g. a run that still executed a workflow step the current branch no longer has. Current merge-ref is what matters: `git fetch origin '+refs/pull/<n>/merge:refs/remotes/pr/<n>/merge'` and inspect it. To force a genuinely fresh run on the correct merge-ref, change the head sha (`git commit --amend --no-edit` + force-push), not just reopen.

Agent duties are central ([`.standards/AGENTS.md`](../.standards/AGENTS.md)); this repo's session workflow and plan-tracker convention are in [`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](../CLAUDE.md).
