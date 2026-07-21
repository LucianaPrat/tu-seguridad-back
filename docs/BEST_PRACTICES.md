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

## Production secrets: sops + age

Production secrets are **not** kept as plaintext `.env` on the host. They live git-encrypted with [`sops`](https://github.com/getsops/sops) + [`age`](https://github.com/FiloSottile/age) (both free CLI tools, no running service — ruled out AWS Secrets Manager / Vault for the same cost reason as Redis). The deploy workflow (`.github/workflows/deploy.yml`) decrypts them to `.env` on the host right before `pm2 reload`.

**One-time setup (repo owner, needs prod host access):**

1. Generate an age keypair: `age-keygen -o keys.txt`. It prints the **public** key (`age1...`).
2. Put the private key **only** on the prod host at `~/.config/sops/age/keys.txt` (never commit it — `.gitignore` blocks `keys.txt`/`*.age`), and also store it as the GitHub Actions secret `SOPS_AGE_KEY` if a runner ever needs to decrypt.
3. Commit a `.sops.yaml` at the repo root pinning the recipient (replace with the real public key):
   ```yaml
   creation_rules:
     - path_regex: secrets\.enc\.ya?ml$
       age: age1yourrealpublickeyhere...
   ```
4. Create the plaintext secrets file (e.g. `secrets.yaml`, gitignored) with the real production values for `JWT_SECRET`, `JWT_REFRESH_SECRET`, `DATABASE_URL`, `FACE_AUTH_TOKEN`, `SNAPSHOT_URL_ENCRYPTION_KEY`, `METRICS_TOKEN`, `SENTRY_DSN`, etc., then encrypt it:
   ```bash
   sops -e secrets.yaml > secrets.enc.yaml
   ```
   Commit **only** `secrets.enc.yaml`. The plaintext `secrets.yaml` is gitignored; delete it after encrypting.
5. Required repo secrets for the deploy workflow: `PROD_HOST`, `PROD_SSH_USER`, `PROD_SSH_KEY`, `PROD_APP_DIR` (absolute path of the checkout on the host). Optional repo variable `PROD_APP_PORT` (defaults to `3000` for the health gate).

**Key rotation:** generate a new age keypair, add the new public key as a second recipient in `.sops.yaml`, re-encrypt (`sops updatekeys secrets.enc.yaml`), deploy so the host picks up the new file, then remove the old recipient and re-encrypt again. Never edit `secrets.enc.yaml` by hand — always go through `sops`.

`git grep -iE "(password|secret|token|mysql://)" -- ':!*.example' ':!*.md' ':!*spec*'` must never surface a real value.

## Working with AI agents on this repo

- Never leave Claude/Codex/agent traces in commits or PRs — human identity only. Full rule: [`CONTRIBUTING.md`](../CONTRIBUTING.md).
- Session workflow for plan tasks: one agent (higher-effort model) plans a task into a concrete, unambiguous blueprint (exact files/signatures/decisions) before any code is written; a second agent implements that blueprint literally; the orchestrating session verifies build/lint/test itself before committing. Keeps implementation agents from having to make silent judgment calls on ambiguous plan wording.
- `plans/01.setup.tasks.md` is the live source of truth for "what's done" — update it every time a task finishes, before moving to the next one.
