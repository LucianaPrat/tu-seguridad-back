# Best practices / gotchas

Ops + tooling lessons from building this repo. Not architecture (see [`ARCHITECTURE.md`](../ARCHITECTURE.md)), not workflow (see [`CONTRIBUTING.md`](../CONTRIBUTING.md)) — this is "learned it the hard way once, write it down so nobody repeats it."

## git / gh

- Repo git identity set at repo level (`git config user.name/user.email`), separate from any global config. Verify before first commit in a new clone/worktree: `git config user.name` should say `danielfrascarelli` / `dsanfra@gmail.com`.
- `gh` may have multiple accounts logged in. Check push access BEFORE assuming: `gh repo view LucianaPrat/tu-seguridad-back --json viewerPermission`. If it says `READ`, switch: `gh auth switch --user danielfrascarelli`.
- GitHub repo canonical casing is `LucianaPrat/tu-seguridad-back` (capital L/P) — `gh api`-backed commands (`gh repo view`, `gh repo edit`) need exact case or 404. Plain `git push`/`git clone` over https redirect fine either way.
- No AI-agent trace in any commit/PR — see [`CONTRIBUTING.md`](../CONTRIBUTING.md). PR descriptions on this repo are written caveman-full style (session-level convention, not a tool default).
- git worktrees (`git worktree add`) only check out committed history. Untracked files — `.env`, any in-progress uncommitted work — do NOT come along. Copy them in manually before running anything that needs them.
- Branch model: `main` = production, never receives a feature branch directly. `develop` = integration branch. `feature/*`, `fix/*`, `chore/*` branch off `main`, PR target is always `develop`.

## Prisma / jest

- `test/jest-int.json` `rootDir` resolves relative to the **directory containing the config file**, not the process CWD. A config living in `test/` with `rootDir: "."` resolves to `test/`, not the repo root — breaks `setupFiles` paths and the test glob. Use `rootDir: ".."` from `test/jest-int.json` to land back at repo root.
- `uuid@14`'s `dist-node` build ships pure ESM (`export {...}`). Jest's default transform doesn't touch `node_modules`, so `import { v4 } from 'uuid'` in a spec throws `SyntaxError: Unexpected token 'export'`. Use Node's built-in `import { randomUUID } from 'node:crypto'` for test fixture IDs instead — no config change needed.
- `package.json#prisma` (the `"prisma": { "seed": ... }` block) is deprecated, warns on every Prisma CLI call. Works fine today; migrate to `prisma.config.ts` eventually, not urgent.
- VS Code Prisma extension flags `datasource db { url, shadowDatabaseUrl }` in `schema.prisma` as deprecated (bundled language server validates ahead against Prisma 7 rules, even though installed CLI is `6.19.3` and still supports inline `url`/`shadowDatabaseUrl` today). Prisma 7 splits this in two: Migrate's connection URL moves to `prisma.config.ts`; `PrismaClient` (`src/data/prisma/prisma.service.ts`) stops reading `DATABASE_URL` implicitly and instead takes an `adapter` (direct connection) or `accelerateUrl` in its constructor. Not urgent — revisit when actually bumping to Prisma 7, confirm exact `defineConfig`/adapter API at that time rather than guessing now.
- MySQL in dev runs as a docker container (`mysql-local`), NOT a systemd service. Don't waste a step on `systemctl start mysql`.

## Infra / CI (plan 02)

- **`npm audit` gate scope.** CI runs `npm audit --omit=dev --audit-level=critical`, not `--audit-level=high` on the full tree. The advisory DB updates constantly, so a full-tree `high` gate turns red on unrelated PRs the moment a new transitive advisory lands (it happened — 30 new `high`s, all dev tooling + transitive prod, 0 critical, appeared days after a green run). Dev-tooling vulns (jest/babel/etc.) never ship; high transitive prod advisories are Dependabot's job. The gate blocks only production-dependency **critical** severity. If it ever fires, fix the dep — don't widen `--audit-level` or `|| true` it.
- **OpenAPI export needs no DB/network.** `scripts/export-openapi.ts` builds the DI container and reads route metadata but **never** calls `app.init()`/`listen()`, so it doesn't connect Prisma — matches how `setupSwagger` builds the live doc. It replicates `main.ts`'s `setGlobalPrefix(... exclude ...)` + `enableVersioning(...)`; if you change prefix/versioning/excludes in `main.ts`, change them in the export script too or `openapi.json` drifts from `/docs-json` and CI's diff check fails.
- **Stacked-PR CI can show stale red.** Reopening a PR (or force-pushing while its base branch changed) can leave `gh pr checks` pointing at an old run computed on a **stale merge-ref** — e.g. a run that still executed a workflow step the current branch no longer has. The current merge-ref is what matters: `git fetch origin '+refs/pull/<n>/merge:refs/remotes/pr/<n>/merge'` and inspect it. To force a genuinely fresh run on the correct merge-ref, change the head sha (`git commit --amend --no-edit` + force-push), not just reopen.

## Working with AI agents on this repo

- Never leave Claude/Codex/agent traces in commits or PRs — human identity only. Full rule: [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- Session workflow for plan tasks: one agent (higher-effort model) plans a task into a concrete, unambiguous blueprint (exact files/signatures/decisions) before any code is written; a second agent implements that blueprint literally; the orchestrating session verifies build/lint/test itself before committing. Keeps implementation agents from having to make silent judgment calls on ambiguous plan wording.
- `plans/01.setup.tasks.md` is the live source of truth for "what's done" — update it every time a task finishes, before moving to the next one.
