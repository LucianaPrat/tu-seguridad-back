# Audit backlog — 2026-08-22

Whole-repo audit of `develop` at `6aa1b44`. Every finding below was read in the source and
confirmed, not inferred from a document. Where a number is quoted, the command that produced it is
named so it can be re-run.

This file does **not** restate [`STANDARDS_GAPS.md`](STANDARDS_GAPS.md). That file owns "the rule
applies and we do not meet it yet"; this one owns defects, unmerged work, and sizing. Where the two
touch, this file links and adds only the measurement.

Findings are the state at the audit commit. Two of them have been fixed since and are marked as
such in place; the rest were still open when this was committed.

## Baseline — everything green

| Check | Result |
|---|---|
| `npm run lint` (`--max-warnings 0`) | pass, zero warnings |
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npm test` | 55 suites / 441 tests |
| `npm run test:int` | 2 suites / 27 tests |
| `npm run test:e2e` | 7 suites / 75 tests |
| `npm run test:cov` | 84.45% stmts, 74.52% branch, 83.61% lines |
| `npm run security` | pass — 0 critical in production deps (6 **high** are open, item 16) |

543 tests, all passing. The findings below are latent, not regressions — nothing here is currently
breaking a suite, which is exactly why they are worth writing down.

---

## P0 — fix before the next deploy

### 1. Unbounded file upload can OOM the whole process — [#58](https://github.com/LucianaPrat/tu-seguridad-back/issues/58)

`src/modules/cameras/cameras.controller.ts:277` — `@UseInterceptors(FileInterceptor('file'))`
carries no `limits.fileSize`, and neither `main.ts` nor `app.module.ts` sets a global multer or
body-parser limit. Multer's default memory storage buffers the entire upload into `file.buffer`
**before** the handler runs, and the `SNAPSHOT_MAX_BYTES` guard is in the service
(`cameras.service.ts:155`) — after the bytes are already in RAM.

Why it is P0 and not a nuisance: deployment is a single PM2 **fork** (`ecosystem.config.js`), so
there is one process. Any space member with a completed profile can post one oversized multipart
and take down the API — including `PollingScheduler`, so every space stops being monitored.

Fix, in the decorator so the limit applies before the buffer grows:

```ts
@UseInterceptors(FileInterceptor('file', { limits: { fileSize: <SNAPSHOT_MAX_BYTES> } }))
```

The value has to come from config, so read it in a small factory rather than hard-coding it; the
service-level check stays as the second line of defence. Multer answers an over-limit upload with
`LIMIT_FILE_SIZE`, which needs mapping to `VALIDATION_ERROR` to keep one error shape on the route
(see the global-filter gap in [`STANDARDS_GAPS.md`](STANDARDS_GAPS.md) — same missing piece).

**Check to leave behind:** an e2e post of `SNAPSHOT_MAX_BYTES + 1` bytes asserting 400 and a live
process afterwards.

### 2. One camera's failure aborts the rest of the poll tick — [#59](https://github.com/LucianaPrat/tu-seguridad-back/issues/59)

**Fixed** in `b5ea0a7`, merged to `develop` in #75. `pollOnce` is now guarded per camera: the
throw is logged, recorded as `INTERNAL_ERROR` on that camera's status, and the loop continues.

`src/modules/pipeline/polling.scheduler.ts:74-81` — `tick()` is

```ts
for (const spaceId of spaceIds) {
  const cameras = await this.cameraAccessor.findPollableBySpace(spaceId);
  for (const camera of cameras) {
    await this.pollOnce(spaceId, camera);   // no try/catch
  }
}
```

and `pollOnce` (`:89-131`) is `try { … } finally { … }` — no `catch`. Expected failures come back as
`Either` and are recorded, so this only fires on an unexpected throw (database blip, accessor bug, an
upstream exception that escapes its wrapper). When it fires, every remaining camera **and every
remaining space** is skipped for that tick, and the only trace is the top-level
`.catch(… 'polling tick failed')` at `:55-57`.

A surveillance poller that silently stops mid-batch on one bad camera is a monitoring gap, not a
logging nit. Wrap the per-camera call so a sibling cannot starve the batch:

```ts
for (const camera of cameras) {
  try {
    await this.pollOnce(spaceId, camera);
  } catch (error: unknown) {
    this.logger.error(`poll failed for camera ${camera.id}`, error);
    this.statusRegistry.record(camera.id, { lastErrorAt: new Date() });
  }
}
```

`pollOnce`'s own rethrow is asserted by `polling.scheduler.spec.ts:193-204`, so keep it and catch at
the call site. **Check:** a spec where camera A throws and camera B is still polled.

---

## P1 — this iteration

### 3. Login and recovery leak account existence through response time — [#60](https://github.com/LucianaPrat/tu-seguridad-back/issues/60)

`DATA_MODEL_REQUIREMENTS.md` → *Security notes* states the invariant: magic link, password recovery
and invitation endpoints "must answer the same way for a registered and an unregistered email". The
bodies match. The timing does not.

- `src/modules/auth/auth.service.ts:39-41` — an unknown email returns after one `findByEmail`
  (~1 ms). A known email runs `bcrypt.compare` at cost 10 (tens of ms) before rejecting. The delta
  separates "no such account" from "wrong password" behind identical 401s.
- `src/modules/auth/credential-recovery.service.ts:112` — the unknown path returns after one
  lookup; the real path additionally inserts a token row and `await`s `delivery.deliver(...)`, an
  SMTP round trip in production, before answering the same 202.

Fix for login: compare against a fixed dummy hash on the not-found path so both branches pay bcrypt
once. Fix for recovery: stop awaiting delivery on the request path — issue and send without blocking
the response, so the answer is constant-time by construction rather than by padding.

### 4. A redrawn zone keeps alerting on its old shape — [#61](https://github.com/LucianaPrat/tu-seguridad-back/issues/61)

**Fixed** in `9940fc8`, merged to `develop` in #75. `ZonesService.update` and `delete` call
`resetOccupancy` after a successful write, so a refused update leaves the streak alone.

`src/modules/zones/zones.service.ts:90` (`update`) changes a zone's rectangle or outline and never
touches the pipeline — `zones.service.ts` holds no reference to `PipelineService` at all.
`OccupancyEngine.states` (`occupancy.engine.ts:45`) is keyed `cameraId:zoneId` and carries the
hysteresis streak, so the streak survives the reshape.

Operator-visible consequence: redraw a zone to exclude the street, and the zone stays "occupied" for
up to `EXIT_CONSECUTIVE_POLLS` polls, still raising alerts for an area no longer inside it. This is
the half of the stale-state problem that is a behaviour bug rather than a leak.

Fix: call `pipelineService.resetOccupancy(cameraId)` from `ZonesService.update` and `delete`, the
same way `CamerasService.update` already does at `cameras.service.ts:98-100`.

### 5. Swagger is served in production — [#62](https://github.com/LucianaPrat/tu-seguridad-back/issues/62)

`src/main.ts:47` calls `setupSwagger(app)` unconditionally, so `/docs` and `/docs-json` publish the
full route table, every DTO schema, and the error-code vocabulary to anonymous callers in
production. `openapi.json` is committed for the contract check, so nothing depends on the live
endpoint outside development.

Fix: gate the call on `NODE_ENV !== 'production'`. If production access is wanted later, reuse the
header-token guard pattern the metrics route on `infra/t04-prometheus-metrics` already uses rather
than inventing a second one.

### 6. Rate limiting is off everywhere except production, and never tightened on auth — [#63](https://github.com/LucianaPrat/tu-seguridad-back/issues/63)

`src/cross/config/throttler.options.ts:14` — `skipIf: () => NODE_ENV !== 'production'`. Any
deployment whose `NODE_ENV` is `staging`, `qa`, or anything else gets no rate limiting at all on
`/auth/login`, `/auth/password-reset/*` and `/auth/magic-link/*`. Gate on an explicit
`THROTTLE_ENABLED` instead of a "not literally production" test.

Separately: the global bucket is the only bucket. `THROTTLE_LIMIT=10` / `THROTTLE_TTL_SECONDS=1` is
10 requests per second per IP — a request-flood ceiling, not a credential-stuffing defence
(864k login attempts/day within budget). No route carries a `@Throttle` override; the only throttler
decorator in `src/` is the deliberate `@SkipThrottle()` on the MediaMTX hook. Add a tight per-route
limit on the credential routes.

`trust proxy` is `'loopback'` (`main.ts:24`), so the `X-Forwarded-For`-derived tracker cannot be
spoofed from off-box. That part is correct and should stay.

---

## P2 — soon, all small

### 7. Concurrent invitation accepts answer 500 instead of 409 — [#64](https://github.com/LucianaPrat/tu-seguridad-back/issues/64)

`src/modules/invitations/invitations.service.ts:151` — `findByUserId` ("not a member yet") and
`acceptWithExistingUser` are not in one transaction. Two concurrent accepts for the same registered
email both pass the check; the loser hits the `space_members.user_id` unique constraint and the
`P2002` is uncaught, surfacing as a 500. `AuthService.register` already catches `P2002` and maps it —
apply the same handling here. The new-user path is safe: the token itself serialises it.

### 8. In-memory maps are never pruned on camera delete — [#65](https://github.com/LucianaPrat/tu-seguridad-back/issues/65)

`src/modules/cameras/cameras.service.ts:109-115` soft-deletes and returns. Neither
`OccupancyEngine.states` nor `CameraStatusRegistry.statuses` (`camera-status.registry.ts:42`) loses
its entry, so both keep one row per camera ever created.

Honest sizing: a few dozen bytes per camera, on a deployment with tens of cameras. Not a memory
problem at this scale — worth doing because it is a one-line call in the same place item 4 adds one,
not because it is urgent on its own.

### 9. Nothing ever deletes an expired token or an old snapshot — [#66](https://github.com/LucianaPrat/tu-seguridad-back/issues/66)

`grep -n "deleteMany\|delete(" src/data/accessors/{auth-token,snapshot}.accessor.ts` returns
nothing, and the only scheduled job in the repo is the camera poll
(`grep -rn "@Cron\|setInterval" src` → `polling.scheduler.ts` only).

- `auth_tokens` keeps every expired refresh, reset, magic-link and invitation row forever. Rows are
  small, and `@@index([expiresAt])` is already in the schema for exactly this sweep.
- `snapshots` keeps every alert BLOB forever. This is the one with a disk bill: at ~100 KB a frame,
  a few hundred alerts a day is single-digit GB a year inside MySQL.

The README roadmap lists snapshot retention as deferred, which is a fair call — but "deferred" and
"there is no code path that can ever delete a row" are different states, and the second is worth
recording. Cheapest honest fix: one `@Cron` calling one `deleteMany` per table, retention window
from config.

### 10. Free strictness wins, and one that is not worth it — [#67](https://github.com/LucianaPrat/tu-seguridad-back/issues/67)

Measured, so the trade is not a guess:

| Change | Cost | Verdict |
|---|---|---|
| `no-explicit-any` → `error` | **0 fixes** — `src/` has zero `any` outside specs | do it |
| `no-floating-promises`, `no-unsafe-argument` → `error` | **0 fixes** — lint is green at `--max-warnings 0`, so there are no warnings to promote | do it |
| `noImplicitOverride` | **1 error** | do it |
| `noUncheckedIndexedAccess` | **88 errors** (47 `src/`, 42 `test/`; ~19 in production code) | see below |

Three of the four lint/type gaps in [`STANDARDS_GAPS.md`](STANDARDS_GAPS.md) cost nothing to close.

`noUncheckedIndexedAccess` is the exception. The largest cluster is
`src/modules/zones/rectangle.ts` (9 of the 19 production errors) and reading it through: every one is
a `for` loop index that is provably in bounds, `points[(i + 1) % points.length]`, and a division the
`straddles &&` short-circuit already guards. 88 non-null assertions for zero defects found in the
worst-affected file. Recommend promoting this one to a declared override in `AGENTS.md` with that
measurement as the reason, rather than leaving it as a gap that reads like pending work.

### 11. The e2e harness boots a different app than production — [#68](https://github.com/LucianaPrat/tu-seguridad-back/issues/68)

Confirmed instance of the `configureApp(app)` gap in [`STANDARDS_GAPS.md`](STANDARDS_GAPS.md), with
the divergence enumerated. `test/utils/bootstrap-e2e-app.ts` replays `main.ts` and omits:

`helmet()` · `compression()` · `enableCors()` + `CORS_ORIGINS` · `SocketIoAdapter` ·
`app.set('trust proxy', …)` · `enableShutdownHooks()`

So no e2e test can catch a CORS regression, a security-header regression, or a WebSocket-adapter
regression — and the WS specs exercise Nest's default adapter, not the one production installs. The
proof is in the e2e log: responses carry `x-powered-by: Express`, which `helmet()` would have
stripped. Extracting one exported `configureApp(app)` shared by `main.ts`,
`scripts/export-openapi.ts` and this harness closes all of it.

### 12. Make the coverage gate able to fire — the threshold is already met — [#69](https://github.com/LucianaPrat/tu-seguridad-back/issues/69)

`STANDARDS_GAPS.md` says measured unit coverage is 77.2% and must be raised past 80 before the gate
can be switched on. That is now stale: `npm run test:cov` reports **84.45% statements / 83.61%
lines** against a `lines: 80` threshold. Nothing needs raising. Point the unit leg of `test:all` at
`npm run test:cov` and the gate starts working today.

Worth knowing where the remaining gap sits, because the headline number hides it:

| Area | Stmts | Note |
|---|---|---|
| `src/data/accessors` | 27.0% | 17 accessors, no unit specs; two int-specs cover a slice |
| `src/cross/config` | 28.6% | `logger.options`, `socket-io.adapter`, `swagger.config`, `throttler.options` at 0% |
| `src/modules/auth` | 99.7% | — |

The accessor number is the one that matters: 24 files across accessors and mappers have no sibling
spec at all. `camera.accessor.int-spec.ts` exists on `infra/t06-secrets-encryption` and never
reached `develop` (see below).

---

## P3 — housekeeping, but one item is misleading a reader

### 13. Three plan-02 tasks are marked done and are not on `develop` — [#71](https://github.com/LucianaPrat/tu-seguridad-back/issues/71)

`plans/02.infra-hardening.tasks.md` marks T04 **"✅ Done and committed"**. `develop` has no
`src/cross/metrics/`, no `@willsoto/nestjs-prometheus` in `package.json`, and no `/metrics` route.
The code is real but it sits on an unmerged branch.

Verified with `git rev-list --count develop..<branch>`:

| Branch | Commits ahead of `develop` | Contents | Tracker says |
|---|---|---|---|
| `feat/infra-hardening` | 10 | superset of everything below plus what did land | — |
| `infra/t04-prometheus-metrics` | 1 | `/metrics`, 4 custom metrics, token guard | "✅ Done and committed" |
| `infra/t02-deploy-pipeline` | 1 | `.github/workflows/deploy.yml` | "✅ Code committed · ⚠️ manual verify pending" |
| `infra/t06-secrets-encryption` | 2 | sops/age procedure, `camera.accessor.int-spec.ts` | "✅ Done and committed · ⚠️ prod steps pending" |

`README.md:289` gets this right — it lists all three as in flight and not on `develop` — so the
tracker is the file that misleads. T02's wording is defensible ("code committed", on a branch);
T04's is not. T06's field encryption did land, by another route: plan 03 dropped the `snapshotUrl`
column and `field-encryption.service.ts` now protects `dvrs.password_encrypted` instead, which
`README.md:289` already explains.

Two things to do, in this order:

1. Decide each branch: merge, or close and delete. `feat/infra-hardening` being 10 ahead while three
   of its tasks also live on their own branches means the same work exists twice — pick one lineage.
2. Give the tracker legend a state that means "committed on a branch, not on `develop`". The current
   legend cannot express it, which is how T04 came to read as shipped.

### 14. CI and hooks — [#72](https://github.com/LucianaPrat/tu-seguridad-back/issues/72)

All from [`STANDARDS_GAPS.md`](STANDARDS_GAPS.md), re-verified as still open, listed here only so
the audit is complete: `pr-tests.yml` checks out without `submodules: true` (so `.standards/` is
empty in CI); no `validate-standards` workflow; no PR-body agent-trace check; `.husky/` has only
`commit-msg` (commitlint) and `pre-commit` (lint-staged) — the agent-trailer and author checks the
hooks override promised are not ported; no `CODEOWNERS`, no PR template.

Also `pr-tests.yml` triggers on `pull_request` and `push: [main]`. The base branch is `develop`, so a
direct push to `develop` runs nothing. Add it to the push list.

### 15. Tidy — [#73](https://github.com/LucianaPrat/tu-seguridad-back/issues/73)

- **25 symbols exported but used only inside their own file.** Not dead code — verified with
  `find_referencing_symbols` that each has a same-file caller (e.g. `buildSwaggerConfig` ←
  `createOpenApiDocument`; `containsPointInRectangle` ← `containsPoint`). Drop the `export` keyword;
  the modules stay identical. Mostly accessor input/output interfaces and zone-math helpers.
- **`Uint8Array.from(image.data)`** at `src/modules/snapshots/snapshot.service.ts:112`. `Buffer`
  already *is* a `Uint8Array`, and `TypedArray.from` walks `Symbol.iterator` one byte at a time —
  this runs synchronously on every poll of every camera, since a live frame is written on every
  successful poll. Pass the buffer through, or `new Uint8Array(d.buffer, d.byteOffset, d.byteLength)`
  for a zero-copy view.
- **`src/modules/auth/dto/login.dto.ts:9`** — `password` has `@MinLength(1)` and no `@MaxLength`,
  unlike `RegisterDto`, `CompleteProfileDto` and `ResetPasswordDto`, which all cap at
  `AuthPolicy.MAX_PASSWORD_LENGTH`. It is the one password field that reaches bcrypt on every
  request. Add the cap.
- **`scripts/mediamtx.sh`**, `restart` branch — runs `compose up -d --force-recreate`, then calls
  `cmd_up`, which runs it again. Harmless, twice the container churn. Drop the first call.
- **No `engines.node`, no `packageManager`** in `package.json`, while `.nvmrc` pins the version.
- **8 files import across 2+ directory levels** (7–9 each: `invitations.service.ts`,
  `invitations.controller.ts`, `auth.controller.ts`, `auth.service.ts`, `session.service.ts`,
  `face-identity.controller.ts`, `credential-recovery.service.ts`, `alert-events.service.ts`). No
  `paths` aliases in `tsconfig.json`, none mirrored in Jest.

### 16. Six open high-severity advisories in production dependencies — [#70](https://github.com/LucianaPrat/tu-seguridad-back/issues/70)

`npm run security` passes, correctly — the gate is `--omit=dev --audit-level=critical` and there are
zero criticals. But `npm audit --omit=dev --audit-level=high` reports **6 high**, all transitive:

| Package | Path | Advisory | Fix |
|---|---|---|---|
| `brace-expansion` 2.0.0–2.1.3 | `rimraf/node_modules` | two DoS / OOM advisories, the second bypassing the CVE-2026-14257 mitigation | `npm audit fix` |
| `js-yaml` 5.0.0–5.2.1 | `@nestjs/swagger/node_modules` | exponential parse time in flow collections → DoS | `npm audit fix` |
| `deepmerge-ts` <8.0.0 | via `@prisma/config` | — | `npm audit fix --force` (breaking) |

The gate's scope is a deliberate, well-argued decision
([`BEST_PRACTICES.md`](BEST_PRACTICES.md), *`npm audit` gate scope*) and should not be widened — that
doc explicitly assigns high transitive production advisories to Dependabot. The finding is therefore
not "the gate is wrong", it is that the mechanism meant to clear these has not: `.github/dependabot.yml`
exists, and six advisories are open anyway, two of them one plain `npm audit fix` behind.

Do the two safe ones now. Check whether Dependabot is actually opening PRs against `develop` — if it
is not, the critical-only gate is resting on a fallback that is not running.

---

## Clean — checked and nothing to report

Recording these so the next audit does not re-derive them.

- **Env configuration.** 44 keys agree exactly across `.env.example`,
  `env-validation.schema.ts` and `EnvNames`. No drift in either direction.
- **Dependencies.** 38 production deps, every one imported from `src/`, `test/`, `scripts/` or
  `prisma/`. No bloat to cut. (Vulnerability state is *not* clean — see item 16.)
- **`any`.** Zero occurrences in `src/` outside specs, under `strict: true`.
- **Secret containment.** `SENSITIVE_FIELD_NAMES` is genuinely the single list both egress channels
  read. Traced the one case that looked like a miss: `sourceUrl` (the RTSP URL carrying the recorder
  password) is absent from the list, but it only ever leaves as the `source` key in the MediaMTX
  request body — and `source` *is* listed, with a comment explaining precisely that. Correct.
- **Accessor layering.** `grep -rn "PrismaService" src/modules/` is empty, as `AGENTS.md` requires.
- **`POST /streaming/authorize`.** `@Public()` and `@SkipThrottle()` on a token-verifying route
  looks alarming and is right: the media server holds no session, the token is verified on every
  call before the memo is consulted, and the route discloses nothing `GET /cameras/:id` does not.
  The reasoning is already in the file. Same for the 3-second authorization memo.
- **Prisma indexes.** Every space-scoped read path has a matching composite index, including
  `@@index([spaceId, detectedAt(sort: Desc)])` for the keyset pagination and
  `@@index([cameraId, deletedAt])` for the soft-delete reads.
- **Password policy.** Min 12, max 128, bcrypt behind a single service with a documented argon2id
  migration path. `passwordHash` is non-nullable, so no null-hash crash is reachable.
- **Poll re-entrancy.** The `inFlight` Set in `PollingScheduler` correctly prevents a slow camera
  from queueing a backlog. (The batch-abort problem in item 2 is a different bug in the same file.)
- **`trust proxy`.** `'loopback'`, so the throttler's `X-Forwarded-For` tracker cannot be spoofed
  remotely.
- **Existing `ponytail:` ceilings.** All seven re-read against current behaviour. Six still hold.
  The seventh — `mediamtx-stream-publisher.service.ts:24`, "nothing ever deletes a path" — is inert
  rather than fine: `authorize` refuses readers of a disabled or deleted camera regardless of the
  stale path, so the leak has no security consequence, but it is genuinely never cleaned up rather
  than merely deferred.

---

## Suggested order

Items 1 and 2 are the only ones that can take the service down; they are also both small. Item 2
is done, which leaves item 1 alone at the top. Everything in P1 is a one-file change. The free strictness flags in item 10, the coverage gate in item 12 and
the two safe `npm audit fix` bumps in item 16 are worth folding into whichever commit touches CI,
since none of them needs a code change.

Item 13 is not code, but it is first among the housekeeping: while the tracker claims T04 shipped,
anyone reading it will assume the API exposes metrics it does not have.

The two roadmap items nothing here supersedes — a notification provider (delivery rows are written
`pending` and no code ever moves them) and authentication for `POST /events/acknowledgements` (public
today, correlation id as its only credential) — stay where `README.md` → *Roadmap* put them. They are
scope, not defects, and they belong in `plans/04.*` when that plan gets written.
