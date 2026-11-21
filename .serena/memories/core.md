# Core

NestJS backend, TypeScript, Prisma/MySQL. Rules are two-layered:
`.standards/` (git submodule, central engineering standards — layering, error strategy,
config, test shape, commits, CI, security) and `AGENTS.md` (repo root — project facts, git
identity, `Applicable standards` map, check commands, repo-specific rules, declared
overrides). Read `AGENTS.md` first, then the central docs it maps to.
`ARCHITECTURE.md` has the reasoning behind the repo's own decisions;
`docs/STANDARDS_GAPS.md` lists where the repo does not meet the standards yet.
Do not duplicate their content here — these memories add structure/commands those docs
don't spell out.

## Source map

- `src/modules/<name>/` — feature modules: `auth`, `cameras` (+ `camera-status`), `events`,
  `face-auth-client`, `health`, `pipeline`, `zones`. Each: DTOs, mapper, service
  (`Either`-returning), controller, module.
- `src/data/accessors/` — Prisma data-access layer (`camera`, `hit`, `user`, `zone`,
  `zone-event`). Only layer allowed to touch `PrismaService` directly.
- `src/data/prisma/` — `PrismaService`.
- `src/cross/` — usable everywhere: `common` (constants, JWT payload type), `config`
  (env validation schema, logger, socket.io adapter, swagger), `decorators`
  (`current-user`, `public`), `errors` (`either.ts`), `guards` (`jwt-auth.guard.ts`),
  `interceptors` (`either.interceptor.ts`, `hit.interceptor.ts`).
- `src/observability/` — OpenTelemetry tracing setup.

For module-specific or tech-stack detail: `mem:tech_stack`, `mem:suggested_commands`,
`mem:conventions`, `mem:task_completion`.
