# Architecture

Source of truth for the full plan: [`plans/01.setup.md`](plans/01.setup.md). This doc captures conventions + decisions learned while implementing it, not a copy of the plan.

## Layering (hard rule)

`modules → data (accessors) → Prisma`. `cross` usable everywhere. Feature modules NEVER inject `PrismaService` directly — always through an accessor. Enforce with `grep -rn "PrismaService" src/modules/` → must stay empty.

Services return `Either<T>` (`src/cross/errors/either.ts`), controllers return the Either, global `EitherInterceptor` unwraps it. No `try/catch` in controllers, no ExceptionFilters.

Env access only via `ConfigService.get(EnvNames.X)`, never `process.env` outside bootstrap/tracing.

## Data accessor layer (T08)

One file per aggregate under `src/data/accessors/`: `user.accessor.ts` → `UserAccessorService`, same pattern for `camera`, `zone`, `zone-event`, `hit`. All `@Injectable()`, `constructor(private readonly prisma: PrismaService)`, exported by the global `DataModule` (which also exports `PrismaService` itself — needed by future health-check + e2e-truncate code).

Accessors are thin. No `Either`, no DTOs, no business rules:
- Plain Prisma calls in, Prisma model types out.
- Prisma **Unchecked** input types (`ZoneUncheckedCreateInput`, `ZoneEventUncheckedCreateInput`) so callers pass scalar FKs (`cameraId`) directly instead of `camera: { connect: {...} } }`.
- `CameraAccessorService.delete()` is a plain passthrough — it does NOT pre-check zones. `Zone.cameraId` is `onDelete: Restrict`, so deleting a camera with zones throws a Prisma `P2003` at the DB level. `countZones()` exists so the future service layer can pre-check and return a clean `409 CONFLICT` instead of leaking the DB error. Business rule lives in the service, not the accessor.
- `ZoneEventAccessorService.query()` applies `take: filter.limit` as given — it does NOT clamp to a max. Default-100/max-1000 clamping is a future `EventsService` (T13) responsibility.
- `HitAccessorService.create()` has no internal try/catch — errors propagate. Fire-and-forget swallowing is the caller's job (T17 `HitInterceptor`).

## Domain model

`schema.prisma` is the source of truth for exact fields. One deviation from the plan's env-var list (§6): `SHADOW_DATABASE_URL` was added for Prisma's shadow database during `migrate dev` — validated as optional in the Joi schema, not in the original plan text.

## Testing layers

- **Unit** (`*.spec.ts`): root jest config, `testRegex: ".*\\.spec\\.ts$"`. Deliberately does NOT match `*.int-spec.ts` (different suffix shape: `-spec` not `.spec`) — no DB, no network.
- **Integration** (`*.int-spec.ts`): own config `test/jest-int.json`, run via `npm run test:int`. Hits the REAL local `DATABASE_URL_TEST` database. Colocated next to the accessor they test (`src/data/accessors/*.int-spec.ts`), not under `test/`.
  - Safety is doubled on purpose: `test/setup-int-env.ts` (Jest `setupFiles`) forces `process.env.DATABASE_URL = process.env.DATABASE_URL_TEST` and throws if `DATABASE_URL_TEST` looks wrong; EVERY spec additionally builds its own client with `new PrismaService({ datasourceUrl: process.env.DATABASE_URL_TEST })`. Never rely on ambient `.env` alone in an int-spec — a bug there means truncating the DEV database.
  - `beforeEach` truncates in FK-safe order: `zone_events` → `zones` → `cameras` → `users` → `hits`.
  - Specs bypass Nest DI — plain `new XAccessorService(prisma)`, manual `$connect`/`$disconnect` in `beforeAll`/`afterAll`.
- **E2E**: not built yet, formalized in T19. Note for whoever writes T19: keep `test:int` wired through `test/jest-int.json` (the env-guard config), don't replace it with a bare `--testRegex` invocation — that form skips the test-DB safety guard entirely.

## Infra

MySQL runs in a docker container (`mysql-local`, port-mapped to `127.0.0.1:3306`) in this dev setup, not a systemd service. `docker ps` to check it, not `systemctl`.

More tooling/ops gotchas (not architecture, but learned building this): [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).
