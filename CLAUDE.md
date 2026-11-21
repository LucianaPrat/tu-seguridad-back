# CLAUDE.md

Read [`AGENTS.md`](AGENTS.md) first — it carries the project facts, the git identity, the
`Applicable standards` map, and the declared overrides. Everything generic lives in the
[`.standards/`](.standards/README.md) submodule; read order and precedence are owned there. This
repo keeps a single tool-agnostic source of truth rather than near-duplicate per-tool files that
drift apart.

Claude Code specific notes:

- Session workflow for plan tasks on this repo: one agent (higher-effort model) plans a task into a
  concrete, unambiguous blueprint (exact files/signatures/decisions) before any code is written; a
  second agent implements that blueprint literally; the orchestrating session verifies
  build/lint/test itself before committing. Keeps implementation agents from having to make silent
  judgment calls on ambiguous plan wording. See [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).
- `.standards/` is a submodule. A worktree created with `git worktree add` starts with it empty —
  run `git submodule update --init` before relying on any central rule.
