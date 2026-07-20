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
