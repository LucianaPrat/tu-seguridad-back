# Contributing

The contributor workflow, branch model, commit format, authorship rules, PR shape, and review rules
are central. They are not repeated here:

- Workflow, task to merged change: [`.standards/standards/CONTRIBUTING.md`](.standards/standards/CONTRIBUTING.md)
- Branches, commits, authorship, no-agent-traces: [`.standards/standards/GIT.md`](.standards/standards/GIT.md)
- PR size, description fields, approvals: [`.standards/standards/PR.md`](.standards/standards/PR.md)
- Check names and when each runs: [`.standards/standards/CHECKS.md`](.standards/standards/CHECKS.md)

Read order and precedence: [`.standards/README.md`](.standards/README.md). Project facts, git
identity, declared overrides, and this repo's check commands: [`AGENTS.md`](AGENTS.md).

The standards are consumed as a git submodule. A fresh clone or a new worktree has an empty
`.standards/` until you run:

```bash
git submodule update --init
```

## What is specific to this repo

- **PR titles and bodies are written caveman-full** — English, terse, no filler, technical substance
  intact. Repo convention, not a tool default. Declared in [`AGENTS.md`](AGENTS.md).
- **CI**, `.github/workflows/pr-tests.yml`, runs against a throwaway MySQL 8 service container:
  `npm ci` → `npm audit --omit=dev --audit-level=critical` → `npm run lint` → `npm run build` →
  OpenAPI drift check → `npx prisma migrate deploy` + seed → `npm run test:all`.
  The audit gate's scope and the OpenAPI drift check are stack-specific additions on top of
  [`.standards/standards/DELIVERY.md`](.standards/standards/DELIVERY.md); where this pipeline still
  falls short of the canonical order and check set is recorded in
  [`docs/STANDARDS_GAPS.md`](docs/STANDARDS_GAPS.md).
- **OpenAPI drift**: if that step fails, run `npm run openapi:export` and commit `openapi.json`.
- **Dependabot** opens weekly grouped dependency PRs targeting `develop`. Review and merge them like
  any other PR; intake rules are in
  [`.standards/standards/DEPENDENCIES.md`](.standards/standards/DEPENDENCIES.md).

Setup gotchas — git identity in a new clone or worktree, `gh` account switching, the repo's canonical
GitHub casing, Prisma and Jest traps: [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).
