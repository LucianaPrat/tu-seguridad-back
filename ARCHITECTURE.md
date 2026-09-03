# Architecture

Plans under [`plans/`](plans/) are the source of truth for what gets built, in order; this doc captures the conventions and decisions learned while implementing them, not a copy of any plan. For the domain model, the current plan is [`03.tenant-alert-data-model`](plans/03.tenant-alert-data-model.md) — it supersedes the setup plan's `User`/`Camera`/`Zone`/`ZoneEvent` shapes wholesale.

## Layering

Layering, accessor isolation, error-strategy, and config rules are central:
[`.standards/stacks/NESTJS.md`](.standards/stacks/NESTJS.md). What this repo picked inside them —
`src/cross/` as the cross-cutting directory, `Either<T>` + `EitherInterceptor` as the error strategy,
and the two files allowed to read `process.env` — is declared in [`AGENTS.md`](AGENTS.md).

This document holds the decisions behind those choices, not a second copy of the rules.

## Data accessor layer

One file per aggregate under `src/data/accessors/`: `user.accessor.ts` → `UserAccessorService`. Fifteen of them today, one per aggregate the tenant model has — user, space, space-member, invitation, auth-token, user-face-identity, dvr, camera, zone (`MonitorZoneAccessorService`), snapshot, alert-routing, alert-event, event-delivery, hit, database-health. All `@Injectable()`, `constructor(private readonly prisma: PrismaService)`, provided and exported by the global `DataModule`, which also exports `PrismaService` itself for the health check and the e2e truncation helper.

Accessors thin. No `Either`, no DTOs, no business rules:
- Plain Prisma calls in, Prisma model types out.
- Prisma **Unchecked** input types (`MonitorZoneUncheckedCreateInput`, `AlertEventUncheckedCreateInput`) so callers pass scalar FKs (`cameraId`) directly instead of `camera: { connect: {...} } }`.
- `HitAccessorService.create()` has no internal try/catch — errors propagate. Fire-and-forget swallowing is caller's job (`HitInterceptor`).

Two rules were added with the tenant model, and both are the reason a service is not allowed to reach Prisma directly (`grep -rn "PrismaService" src/modules/` must stay empty):

- **Tenant scope is a parameter, not a convention.** Every public lookup takes `spaceId` and puts it in its own `where`. A camera, zone or snapshot has no `spaceId` column of its own, so those scope through the relation — `dvr.spaceId`, `camera.dvr.spaceId`. There is no "find by id" that trusts the id alone: a caller cannot forget the scope, because the signature will not compile without it. A row in another space is therefore *not found*, and the service maps that to `404` rather than `403`, since the difference between the two answers confirms the row exists.
- **Deletion is logical, and the predicate is explicit everywhere.** `CameraAccessorService.softDelete()` and the monitor-zone equivalent set `deletedAt`; nothing physically deletes a camera or a zone. Every read — list, detail, count, discovery reconciliation, the poll list, snapshot authorization — carries `deletedAt: null` written out, not hidden behind a Prisma middleware, because the one query that must *not* filter is the alert history, and a global filter would make that exception invisible. The zone FK is `Restrict`, but an `UPDATE` never trips it, so the setup-era `P2003`-on-delete problem no longer exists.

Two accessors carry a transaction because the invariant spans tables and the database cannot express it alone: `DvrAccessorService`'s discovery reconciliation (upsert every discovered channel by `(dvrId, externalId)`, keep the configuration of the ones that matched, mark the vanished ones `isConfigured: false`, never revive a manually deleted camera) and `EventDeliveryAccessorService`'s inbound acknowledgement (claim the delivery on `inboundReceivedAt: null` and acknowledge its event on `acknowledgedAt: null`, so a repeat callback is a no-op and the first responder wins).

## Domain model

`prisma/schema.prisma` is the source of truth for exact fields; [`plans/03.tenant-alert-data-model.md`](plans/03.tenant-alert-data-model.md) §3 is the source of truth for why each relation looks the way it does. The shape in one line: a `Space` is the tenant root, a user belongs to exactly one space through `SpaceMember` (unique on `userId`, so the database enforces it), a space has exactly one `Dvr` (unique on `spaceId`), a DVR owns its discovered `Camera` rows (unique on `(dvrId, externalId)`), and a camera owns `MonitorZone` rows, each a percentage outline with its bounding box. History hangs off the space directly: `AlertEvent` keeps the camera label and alert type copied at detection time and lets its camera/zone/snapshot FKs go `SET NULL`, so a future physical purge cannot erase what happened.

Deviations worth knowing:

- `User.id` and `Hit.id` stayed `Int` while every model introduced by plan 03 uses a UUID `String`. Renumbering users bought nothing and would have churned `hits`, which is technical telemetry and deliberately outside the tenant authorization model.
- `SHADOW_DATABASE_URL` is not in any plan's env list; Prisma needs it for `migrate dev`, and it is validated as optional in the Joi schema.
- One MySQL `CHECK` constraint, `monitor_zones_rectangle_bounds_check`, is hand-written into the migration SQL because Prisma cannot model a cross-column invariant: `x, y >= 0`, `width, height > 0`, `x + width <= 100`, `y + height <= 100`. The service validates the same rules so the API answers a readable `INVALID_ZONE`; the constraint is there for everything that is not the service. Both halves are tested — the DTO path and a raw `INSERT` that MySQL must reject.

## Resilience & observability (plan 02)

Decisions from infra-hardening plan ([`plans/02.infra-hardening.md`](plans/02.infra-hardening.md)). Everything here either always-on-but-passive or **opt-in and a clean no-op when its env var is unset** — never make local dev depend on a new external service. Same posture as `OTEL_ENABLED`.

- **Circuit breaker (opossum).** face-auth upstream is one tenant → **one** in-memory breaker per process, on `FaceAuthClientService`. Breaker action is raw HTTP call that *throws* on failure (public `detectPersons` still returns `Either` and never throws — catches breaker rejection, maps it). Open circuit → `UPSTREAM_ERROR 'face-auth circuit open'`, no call attempted. Breaker global (not per-camera) → state exposed via small `circuitState` getter on service, **not** through per-camera `CameraStatusRegistry` — folding a global signal into per-camera DTO would misrepresent it. No infra dependency (chosen over anything Redis-backed for cost).

- **Error tracking (Sentry).** `initSentry()` runs in `main.ts` **before** `NestFactory.create` (same ordering constraint as `observability/tracing.ts`), gated by `SENTRY_DSN`. `Sentry.captureException` called from one place — `EitherInterceptor`'s `catchError` **unexpected-error** branch (the one producing a 500). Never called for `Either` `ok:false` results or already-mapped `HttpException`s → routine 400/401/404s never reach Sentry. `beforeSend`/`beforeBreadcrumb` scrub and Pino redaction read the *same* list, `SENSITIVE_FIELD_NAMES` (`src/cross/common/sensitive-fields.ts`) — one list, both egress channels, so a new secret-bearing field is covered everywhere in the commit that adds it. Two lists drift, and the drift is only visible in production logs.

- **Tracing has a sidecar, and the poll owns a span.** The API exports OTLP to a collector on loopback ([`ops/otel-collector/`](ops/otel-collector/README.md)), which is the only thing that talks to Grafana Cloud — a managed backend swap is a config change on a process this repo does not deploy, not a release. Two spans are opened by hand: `face-auth.detect`, and `poll.camera` around one camera's whole poll. That parent is what makes the cycle measurable: without it the http auto-instrumentation still timed the ISAPI captures and the detection POST, but each landed as its own root trace with no `cameraId` and no way to sum them, which is the state that made "how long does a poll take" unanswerable. It is also why the collector is its own instance rather than face-api's: that one binds loopback on another host, and two of them pointed at the same tenant still produce a single distributed trace, because the stitching is Tempo's job.

- **Health split.** `/health/ready` stays **DB-only** — load-balancer readiness signal, and a degraded upstream must not pull app out of rotation (can still serve camera/zone CRUD). Upstream reachability lives in **separate** `/health/dependencies` (new `FaceAuthHealthIndicator`, same `HealthIndicatorService` shape as `PrismaHealthIndicator`). Both `@Public()` and `VERSION_NEUTRAL`.

- **Graceful shutdown ordering.** `main.ts` calls `enableShutdownHooks()`. Ordered teardown — stop new poll ticks → disconnect WS clients cleanly → disconnect Prisma — via Nest lifecycle hooks (`onModuleDestroy` on `EventsGateway`, `PollingScheduler`, `PrismaService`), **not** custom signal handlers. Nest tears down in reverse init order → feature modules run before shared `DataModule`, the order we want (WS/scheduler before Prisma). In-flight polls allowed to finish; only new ticks stopped.

- **OpenAPI contract artifact.** `openapi.json` at repo root — diffable, committed artifact, generated by `scripts/export-openapi.ts`. Script reuses `buildSwaggerConfig()`/`createOpenApiDocument()` from `src/cross/config/swagger.config.ts` and replicates `main.ts`'s global-prefix + versioning, but **never** calls `app.init()`/`listen()` — needs no DB or network. CI regenerates and `diff`s it; drift fails build. Keep in sync: `npm run openapi:export` after any DTO/route change.

- **Supply-chain gate scope.** The gate is narrowed to production dependencies at **critical**
  severity, which [`.standards/standards/DELIVERY.md`](.standards/standards/DELIVERY.md) permits as
  long as the scope is stated where it is configured. Why this scope and not `--audit-level=high`:
  [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).

## Outbound mail

One transport for the whole process, `MailerService` (`src/cross/mail/mailer.service.ts`), provided by a `@Global()` `MailModule`. It exists because two unrelated features send mail — credentials from `AuthModule`, alerts from `EventsModule` — and the repo's "point the same code at Gmail with four `.env` variables" property has to hold for both at once. Two transports would drift the first time one gained a TLS option or a pool setting the other did not. The service is the transport and nothing else: it throws on relay failure, and what a failure *means* is each sender's decision.

Those decisions differ, which is why there is no shared "mail sender" abstraction above it:

- **Credential delivery swallows the failure.** `CredentialRecoveryService` owes an identical answer for a registered and an unregistered address, so a throw would make a failed reset distinguishable from a successful one. It is also the reason that path keeps its two-implementation port (`CredentialDeliveryPort` + the logging placeholder): a developer with no relay still has to be able to accept an invitation, so the dev fallback *prints the token*.
- **Alert email records the failure.** `AlertEmailService` (`src/modules/events/alert-email.service.ts`) has an `event_deliveries` row to write the outcome to, so a failure becomes `failed` plus a reason. It needs no second implementation and no port: nothing has to be printed when mail is off, so it is one service that reads `MAIL_ENABLED` itself and returns early. `call` and `whatsapp` have no sender at all, and their rows stay `pending` — the honest state for an attempt nobody made.

Two invariants in `AlertEmailService` are not stylistic. It **never throws** — the pipeline calls it without awaiting, so a rejection would surface as an unhandled one and a relay outage would read as a bug in detection. And the HTML part **escapes** the camera label and the member's first name, the only place operator-supplied text stops being data; a label of `<a href="…">` would otherwise render as a link the recipient can click.

### What the alert mail carries, and why

The message itself lives in `alert-email.template.ts`, separate from the service that sends it, because it is the piece with a design brief rather than a delivery contract: a person reads it on a phone at 3am and has to decide in seconds whether it needs them. So the captured frame is the hero, the recorder's own on-screen-display vocabulary (monospace channel label and timecode) carries what the machine measured, and prose carries what the system is telling a person. Email constraints are absolute — table layout, inline styles, no web font, no external asset — and the template spec asserts them, because the failure mode is silent: a client simply drops what it does not support.

Three decisions inside it are load-bearing:

- **The detection boxes are pixels, not markup.** The frame arrives already annotated — `annotate-frame.ts` composites the upstream's `bboxNorm` rectangles and their `detScore` tags onto the evidence snapshot before the pipeline stores it. Drawing them in HTML instead would mean absolute positioning over the image, which is exactly the class of thing this template refuses everywhere else: a client that does not support it drops it silently, so the box would render in Gmail and vanish in Outlook with nobody the wiser. Burning them in also removes the second code path — `GET /snapshots/:id` serves the same frame the recipient saw. The cost is that the untouched frame is not kept, and annotation is best-effort: a frame the encoder cannot decode is stored raw rather than not stored at all.
- **The frame is inline, not linked.** `cid:` attachment, so it renders with no remote fetch — which also means no tracking pixel and no "images blocked" banner. A linked `GET /snapshots/:id` would show a logged-out recipient nothing, which is most recipients most of the time. This is the one narrowing of the snapshot-bytes rule in [`AGENTS.md`](AGENTS.md), and it is scoped: bytes go to an opted-in member of the space that owns the camera, and nowhere else.
- **The timestamp is wall-clock at the recorder**, read from `Dvr.timezone`, falling back to UTC when the space has no DVR or carries a zone Node cannot resolve. A UTC timestamp in an alert is a small puzzle to solve at exactly the wrong moment.
- **The acknowledge link points at the frontend, not at this API.** Same as every credential link here. A token in a URL this process serves would be written into its own access log on every click; in the request body it is redacted, because `token` is on `SENSITIVE_FIELD_NAMES`. The frontend route the link assumes (`/events/:id/acknowledge?token=…`) posts it to `POST /events/acknowledgements` — that assumption is stated in `alert-email.service.ts` beside the one `CREDENTIAL_MAIL` already makes.

### Acknowledging without a session

`POST /events/acknowledgements` now takes either credential, and which one arrives says who is calling: a provider holds the delivery's `correlationId`, an email recipient holds a token from `EventAckTokenService`. That token is an HMAC over the delivery id, domain-separated and keyed by `JWT_SECRET` — so nothing is persisted, no migration was needed, the link survives a restart, and rotating the secret invalidates every link in flight. It is deliberately *not* the `correlationId`: mailing that value would hand a working acknowledgement to whoever reads the mailbox, forever.

A token that fails its MAC is resolved to nothing and answered `202` like everything else, because the route is unauthenticated and its answer must reveal no event. The only refused shape is both credentials or neither — malformed, not failed, and saying so leaks nothing. `consumeInbound` takes the unique column the caller proved it holds (`{ correlationId }` or `{ id }`) and keeps one implementation: the claim, the ordering and the first-responder rule are identical, and only the credential differs.

Two properties this inherits rather than adds: a replayed link is a no-op, because the claim is guarded on `inboundReceivedAt: null`; and a link stays valid indefinitely, because there is no expiry column and the alert it acknowledges does not expire either.

`markSent`/`markFailed` are guarded on `status: pending` rather than written blind, because `consumeInbound` can set the row `delivered` while the send is still in flight, and overwriting that with `sent` would lose the acknowledgement an operator actually made.

`EventDelivery.error` is served by `GET /events/:id/deliveries`, which every member of the space can read, so what a relay chose to say ends up in an API response. The stored reason is capped at 500 characters and the log keeps the whole thing. The cap is about a `TEXT` column and an unbounded upstream string, not about secrecy: an SMTP rejection can name the relay host, and in a single-tenant space whose members the owner invited, that is accepted rather than scrubbed — the same call the HLS URL gets under [Live streaming](README.md#live-streaming).

## In-app help assistant

`POST /assistant/chat` (`src/modules/assistant/`) is a thin proxy: prepend a system message, call an
OpenAI-compatible gateway, unwrap `choices[0].message.content`. What is worth writing down is what it
deliberately is not.

- **The context is a curated document, not this repository's docs.** Sending `README.md` and this
  file was the obvious implementation and is the wrong one twice over: they are roughly
  thirty-five thousand tokens on every single message, and they name `JWT_SECRET`,
  `DVR_PASSWORD_ENCRYPTION_KEY`, source paths, the plan history and the accessor rules — to anyone
  holding a member's bearer token. `assistant-context.ts` is the operator's half of the same
  knowledge, and the split is the point: a logged-in member is not an operator of this backend.
- **That document is a `.ts` file, not a `.md`.** `nest-cli.json` declares no `assets` and nothing
  else in `src/` does file IO, so a Markdown file would compile out of `dist/` and the route would
  fail in production and nowhere else. `alert-email.template.ts` set the precedent — content with a
  writing brief, kept beside the service that uses it and typechecked with it.
- **The DTO's `role` excludes `system`, which the upstream accepts.** That single `@IsIn` is the
  authorization boundary of the feature: with it, the product context is something only this process
  writes; without it, an authenticated help route is a general-purpose model billed to this project.
  The message and length caps and the 20-a-minute limit in `RouteThrottle.ASSISTANT` are the same
  concern — the global allowance is ten requests a *second*, which for a paid upstream is a bill
  rather than a limit.
- **Stateless, so there is nothing to own.** The client replays the conversation. No table, no
  migration, no `truncate-all.ts` entry, no retention sweep, no space scoping — the only thing the
  route reads is its own body. Persistence was offered and declined; it can be added without moving
  anything, because nothing else refers to a conversation.
- **No circuit breaker and no retry**, unlike `FaceAuthClientService`. A breaker earns its place
  there because a scheduler calls that upstream several times a second unattended, so an open circuit
  saves real wall-clock. Here a person clicked once and is watching; a timeout bounds it and a
  failure is visible to the one caller who cares.
- **An unreadable answer is a failure, not an empty reply.** A body with no usable
  `choices[0].message.content` maps to `UPSTREAM_ERROR` rather than reaching the screen as a blank
  message, which would read as the assistant having nothing to say. Same posture as
  `isDetectPersonsResponse` refusing a detection body it cannot read.

Nothing was added to `SENSITIVE_FIELD_NAMES`: the gateway token exists only in a header this process
builds, `mapUpstreamError` never logs the error it maps, and `pino-http` does not log request bodies
— so neither the token nor a member's question reaches a log or Sentry.

## Retention

Nothing deleted a row until `RetentionService` (`src/modules/retention/`). Consumed and expired `auth_tokens`, settled `invitations`, and every evidence frame ever captured accumulated on the same MySQL instance that serves every query — and a `MEDIUMBLOB` per alert is the one of those with no ceiling. [`docs/decisions/001-mysql-snapshot-storage.md`](docs/decisions/001-mysql-snapshot-storage.md) said retention had to arrive before the table's growth became material; this is it, and it does not replace the object-storage move that ADR still defers.

One nightly job for three sweeps, not three jobs: it is the same question — what is old enough to go — asked of three tables, and three cron entries would be three things to notice had stopped. It is off unless `RETENTION_ENABLED` says otherwise, the opposite default from every other switch here, because a developer who pulls the branch must not find their local history pruned because the process happened to be up at three in the morning.

Three properties are load-bearing:

- **Every sweep is capped.** Prisma cannot put a `LIMIT` on `deleteMany`, so each accessor selects `RETENTION_BATCH_SIZE` ids and deletes those. The first run after this ships has every row the system ever wrote to get through, and one unbounded `DELETE` on that holds a lock for as long as it takes. What the cap leaves behind goes on the next night's run.
- **A swept frame nulls its alert, and the alert stays.** `AlertEvent.snapshotId` is `SET NULL`, so an event whose evidence is past the window keeps its row and loses its bytes. That is the intended outcome rather than a side effect noticed later: the event is the record of what happened, and the label, alert type and detection metrics it copied at detection time are what make the history readable once the frame is gone. It is also why the sweep carries no "still referenced?" clause — events and their frames age together, so a frame past the window is only ever pointed at by an event past it too.
- **Live frames are never swept.** They are one row per camera, rewritten in place, and a camera whose thumbnail was deleted would show a hole in the grid until its next poll.

A sweep that throws is logged and the next one still runs: the three are independent, and a snapshot table that will not delete is no reason to leave expired credentials in place for another day. Each publishes `retention_rows_deleted_total{sweep}`, because a sweep that silently stops deleting is otherwise indistinguishable from one with nothing left to delete.

## Testing layers

- **Unit** (`*.spec.ts`): root jest config, `testRegex: ".*\\.spec\\.ts$"`. Does NOT match `*.int-spec.ts` (different suffix shape: `-spec` not `.spec`) — no DB, no network.
- **Integration** (`*.int-spec.ts`): own config `test/jest-int.json`, run via `npm run test:int`. Hits REAL local `DATABASE_URL_TEST` database. Colocated next to accessor they test (`src/data/accessors/*.int-spec.ts`), not under `test/`.
  - Safety doubled on purpose: `test/setup-int-env.ts` (Jest `setupFiles`) forces `process.env.DATABASE_URL = process.env.DATABASE_URL_TEST` and throws if `DATABASE_URL_TEST` looks wrong; EVERY spec additionally builds its own client with `new PrismaService({ datasourceUrl: process.env.DATABASE_URL_TEST })`. Never rely on ambient `.env` alone in an int-spec — a bug there means truncating DEV database.
  - `beforeEach` truncates through `test/utils/truncate-all.ts`, the single owner of the FK-safe order — leaves first (deliveries, alert events, snapshots, monitor zones, cameras, DVR), then the per-space rows, then spaces, then the setup-era `hits` rows, users last. Specs do not hand-roll their own delete order; one that does passes alone and fails in suite order.
  - Specs bypass Nest DI — plain `new XAccessorService(prisma)`, manual `$connect`/`$disconnect` in `beforeAll`/`afterAll`.
- **E2E** (`*.e2e-spec.ts`, `test/`): own config `test/jest-e2e.json`, run via `npm run test:e2e`. Boots real `AppModule` (HTTP + WebSocket), same test database as int-specs. `test/utils/bootstrap-e2e-app.ts` replicates every piece of `main.ts`'s bootstrap that only lives on `INestApplication` instance — global prefix, versioning, validation pipe, Swagger setup — none of that comes free from `AppModule` alone; skip any and routes silently 404 or land at wrong path. Three ports are overridden with fakes in `test/utils/bootstrap-e2e-app.ts` — `FaceAuthClientService`, `DvrClientPort` and `CredentialDeliveryPort` — so e2e needs no detection upstream, no recorder on the network and no mail relay, and a spec can read the one-time token a real invitee would receive by mail. `ensureAdminSeeded` builds the whole tenant graph (account, space, owner membership, routing defaults), because a bare user is exactly what the login gate rejects: a fixture that inserted one would fail at login instead of at the assertion under test.
- `test:int` stayed wired through `test/jest-int.json` (env-guard config) rather than simplified inline `--testRegex` form from original plan text — that form skips test-DB safety guard (`process.env.DATABASE_URL = process.env.DATABASE_URL_TEST`) entirely.

## Infra

MySQL runs in docker container (`mysql-local`, port-mapped to `127.0.0.1:3306`) in this dev setup, not a systemd service. `docker ps` to check it, not `systemctl`.

More tooling/ops gotchas (not architecture, but learned building this): [`docs/BEST_PRACTICES.md`](docs/BEST_PRACTICES.md).
