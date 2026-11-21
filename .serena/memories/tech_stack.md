# Tech Stack

- Language: TypeScript 5.7, Node.
- Framework: NestJS 11 (`@nestjs/common`, `core`, `config`, `jwt`, `platform-express`,
  `platform-socket.io`, `schedule`, `swagger`, `terminus`, `throttler`, `websockets`).
- DB: MySQL via Prisma 6.19 (`@prisma/client`). Schema: `prisma/schema.prisma`.
  Migrations: `prisma/migrations/`.
- Auth: `@nestjs/jwt`, `bcrypt`.
- Validation: `class-validator` / `class-transformer`, Joi for env schema.
- Logging: `nestjs-pino` + `pino-http` + `pino-pretty`. `snapshotUrl` must never leak
  outside the single-camera detail GET — check redaction config before adding new
  log/response surfaces.
- Observability: OpenTelemetry SDK, OTLP HTTP trace exporter.
- Realtime: `socket.io` / `@nestjs/websockets` / `@nestjs/platform-socket.io`.
- Package manager: npm (no yarn/pnpm lockfile).
- Git hooks: husky + lint-staged + commitlint (`@commitlint/config-conventional`).
- Local dev DB: MySQL runs as a docker container (`mysql-local`), not a systemd service.
