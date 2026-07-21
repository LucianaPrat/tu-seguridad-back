# Core

NestJS backend, TypeScript, Prisma/MySQL. Single tool-agnostic agent-conventions doc:
`AGENT.md` (repo root) — read it directly for hard rules (layering, `Either` pattern, env
access, test suffixes, commit rules, module checklist, Prisma migration workflow).
`ARCHITECTURE.md` has the reasoning behind those rules. `CONTRIBUTING.md` has commit/PR
authorship and branch model. Do not duplicate their content here — these memories add
structure/commands `AGENT.md` doesn't spell out.

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
