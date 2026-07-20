# Contributing

## Commit and PR authorship

Every commit and pull request in this repository is authored as a human contributor. This applies regardless of what tools (AI assistants, code generators, IDE agents, etc.) were used to help produce the change:

- No commit message, commit trailer, PR title, or PR description may reference Claude, Codex, Copilot, or any other AI agent/assistant.
- No `Co-Authored-By: <agent>` trailers, no session links, no "Generated with ..." footers.
- Commits are authored using the repository's configured git identity (`git config user.name` / `user.email`), never an agent's identity.

If a tool you're using appends this kind of trailer or footer automatically, strip it before committing/pushing. If it has already been committed but not yet pushed or opened as a PR, rewrite the commit (e.g. `git commit --amend`, or `git reset --soft` + recommit) to remove it before it goes any further.

## Commit style

- Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`, `docs:`, `ci:`).
- One logical change per commit.
- All commit messages, code, and comments in English.

## Branch model

- `main` — production. Never receives a feature branch directly, ever.
- `develop` — integration branch. All feature work merges here first.
- `feature/*`, `fix/*`, `chore/*` — cut from `main`, descriptive name (e.g. `feature/prisma-schema-and-data-accessors`), PR target is always `develop`.

PR descriptions on this repo are written caveman-full style (short, no filler, technical substance intact) — session-level convention for this project, not a general tool default.

## Setup gotchas

- Verify git identity before your first commit in a new clone/worktree: `git config user.name` / `user.email` must resolve to the repo-level identity (`danielfrascarelli` / `dsanfra@gmail.com`), not whatever your global git config says.
- `gh` may have more than one account logged in. Confirm push access before pushing: `gh repo view LucianaPrat/tu-seguridad-back --json viewerPermission`. `READ` means switch account: `gh auth switch --user danielfrascarelli`.
- The GitHub repo's canonical casing is `LucianaPrat/tu-seguridad-back`. `gh api`-backed commands need that exact case or 404 — `git push`/`clone` redirect fine regardless of case.
- `git worktree add` only checks out committed history. `.env` and any other untracked/uncommitted work do NOT come along automatically — copy them in by hand before running anything that needs them in a new worktree.

More tooling gotchas (Prisma, Jest, general dev loop): [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).
