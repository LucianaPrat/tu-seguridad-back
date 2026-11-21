# Suggested Commands

## Dev / build
- `npm run start:dev` — watch mode.
- `npm run start:debug` — debug on `0.0.0.0:9229`, watch mode.
- `npm run build` — `nest build`.
- `npm run lint` — eslint over `src,apps,libs,test`, auto-fix.
- `npm run format` — prettier write on `src/**/*.ts` and `test/**/*.ts`.

## Tests (three tiers, see `.standards/stacks/NESTJS.md` §Testing for suffix meaning)
- `npm test` — unit only (`*.spec.ts`), excludes `.int-spec`/`.e2e-spec`.
- `npm run test:int` — integration (`*.int-spec.ts`), real test DB, runs via
  `test/jest-int.json` (`rootDir` resolves to repo root, not `test/`).
- `npm run test:e2e` — full app boot (`*.e2e-spec.ts`) via `test/jest-e2e.json`.
- `npm run test:all` — all three in sequence. Run before considering any task done.
- `npm run test:cov` — unit tests with coverage (global line threshold 80%).

## Prisma
- `npx prisma migrate dev --name <description>` — schema change against `DATABASE_URL`.
- `DATABASE_URL="$DATABASE_URL_TEST" npx prisma migrate deploy` — apply same migration
  to the test DB after `migrate dev`.
- `npm run prisma:generate` / `prisma:studio` / `prisma:seed`.
- Never edit an already-applied migration file — add a new one.

## Git / gh (repo-specific gotchas, not generic)
- Identity to verify before the first commit in a new clone/worktree is declared in
  `AGENTS.md`; the rule itself is `.standards/standards/GIT.md` §Authorship.
- `git submodule update --init` — `.standards/` is empty in a fresh clone or worktree.
- `gh repo view LucianaPrat/tu-seguridad-back --json viewerPermission` to confirm push
  access before pushing; `READ` means `gh auth switch --user danielfrascarelli`.
  `gh api`-backed commands need exact repo casing `LucianaPrat/tu-seguridad-back`;
  plain `git push`/`clone` don't care.
- `git worktree add` only checks out committed history — copy `.env` and other
  untracked files in by hand.
