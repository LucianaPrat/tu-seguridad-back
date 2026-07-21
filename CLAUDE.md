# CLAUDE.md

Same conventions as [`AGENT.md`](AGENT.md) — this repo keeps a single tool-agnostic source of truth for agent conventions rather than maintaining near-duplicate files that drift apart. Read `AGENT.md` for the actual rules (layering, `Either`, env access, test suffixes, commit rules, module checklist, Prisma migration workflow).

Claude Code specific notes:

- Session workflow for plan tasks on this repo: one agent (higher-effort model) plans a task into a concrete, unambiguous blueprint (exact files/signatures/decisions) before any code is written; a second agent implements that blueprint literally; the orchestrating session verifies build/lint/test itself before committing. Keeps implementation agents from having to make silent judgment calls on ambiguous plan wording. See [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).
- Never leave a `Co-Authored-By` trailer, session link, or any other agent trace in a commit or PR — human identity only, no exceptions. Full rule: [`CONTRIBUTING.md`](CONTRIBUTING.md).
