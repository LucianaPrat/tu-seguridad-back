# Task Completion

Canonical check names and when each runs: `.standards/standards/CHECKS.md`. What this
repo actually exposes (and which checks are still missing): `AGENTS.md` §Checks.

Before considering any coding task finished:

1. `npm run build && npm run lint && npm run test:all` — all clean. `test:all` runs
   unit + integration + e2e; unit-only passing is not sufficient.
2. If any DTO, route, `@Api*` decorator, or versioning changed: `npm run openapi:export`
   and commit `openapi.json` in the same commit — CI diff-checks it.
3. If anything under `src/` changed, prefer a manual smoke check against the real
   running app over trusting tests alone for user-facing behavior — see
   `docs/BEST_PRACTICES.md` for the local MySQL/docker setup this needs.
4. If a Prisma schema change was made: migration file committed under
   `prisma/migrations/` in the same commit as the schema change, and the same
   migration applied to the test DB (`mem:suggested_commands` has the exact command).
5. If working from a numbered plan under `plans/`: update the companion
   `plans/NN.<name>.tasks.md` tracker (what was built, how verified) before moving to
   the next task.
