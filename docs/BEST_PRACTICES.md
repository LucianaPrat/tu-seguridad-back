# Best practices / gotchas

Ops + tooling lessons from building this repo. Not architecture (see [`ARCHITECTURE.md`](../ARCHITECTURE.md)), not rules — those are central, [`.standards/`](../.standards/README.md), with the repo's own facts and overrides in [`AGENTS.md`](../AGENTS.md). This file is "learned it the hard way once, write it down so nobody repeats it."

## git / gh

- `gh` may have multiple accounts logged in. Check push access BEFORE assuming: `gh repo view LucianaPrat/tu-seguridad-back --json viewerPermission`. If it says `READ`, switch: `gh auth switch --user danielfrascarelli`.
- GitHub repo canonical casing is `LucianaPrat/tu-seguridad-back` (capital L/P) — `gh api`-backed commands (`gh repo view`, `gh repo edit`) need exact case or 404. Plain `git push`/`git clone` over https redirect fine either way.
- A new clone or worktree starts with an empty `.standards/`. Run `git submodule update --init` before relying on any central rule.
- git worktrees (`git worktree add`) only check out committed history. Untracked files — `.env`, any in-progress uncommitted work — do NOT come along, and repo-level `git config` (the identity declared in [`AGENTS.md`](../AGENTS.md)) does not either. Copy `.env` in and verify the identity before running anything.

## Prisma / jest

- `test/jest-int.json` `rootDir` resolves relative to the **directory containing the config file**, not process CWD. A config living in `test/` with `rootDir: "."` resolves to `test/`, not repo root — breaks `setupFiles` paths and test glob. Use `rootDir: ".."` from `test/jest-int.json` to land back at repo root.
- `uuid@14`'s `dist-node` build ships pure ESM (`export {...}`). Jest's default transform doesn't touch `node_modules` → `import { v4 } from 'uuid'` in a spec throws `SyntaxError: Unexpected token 'export'`. Use Node's built-in `import { randomUUID } from 'node:crypto'` for test fixture IDs instead — no config change needed.
- `package.json#prisma` (the `"prisma": { "seed": ... }` block) deprecated, warns on every Prisma CLI call. Works fine today; migrate to `prisma.config.ts` eventually, not urgent.
- VS Code Prisma extension flags `datasource db { url, shadowDatabaseUrl }` in `schema.prisma` as deprecated (bundled language server validates ahead against Prisma 7 rules, even though installed CLI is `6.19.3` and still supports inline `url`/`shadowDatabaseUrl` today). Prisma 7 splits this in two: Migrate's connection URL moves to `prisma.config.ts`; `PrismaClient` (`src/data/prisma/prisma.service.ts`) stops reading `DATABASE_URL` implicitly, instead takes an `adapter` (direct connection) or `accelerateUrl` in its constructor. Not urgent — revisit when bumping to Prisma 7, confirm exact `defineConfig`/adapter API at that time rather than guessing now.
- MySQL in dev runs as docker container (`mysql-local`), NOT a systemd service. Don't waste a step on `systemctl start mysql`.

## Mail (local)

- Dev SMTP is a plain container, same as MySQL — it needs nothing from the repo's compose file, which
  only owns the MediaMTX sidecar:
  `docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit`. Web UI on
  <http://localhost:8025>, SMTP on `1025`, no authentication. Then set `MAIL_ENABLED=true` in `.env`;
  the other mail defaults already point at it. That one switch also turns on alert emails, so a
  detection with `email` enabled in the routing matrix lands in the same inbox. Cleanup:
  `docker stop mailpit && docker rm mailpit`.
- Mailpit **catches** mail, it never delivers it. To land a message in a real Gmail inbox, point the
  same code at Google — no code change, four variables: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`,
  `SMTP_USER=<your gmail address>`, `SMTP_PASSWORD=<16-char App Password>`.

  An App Password is not the account password. It requires 2-Step Verification on the Google account,
  is generated and revoked at <https://myaccount.google.com/apppasswords>, and grants mail-send on
  that account to whoever holds it. It belongs in the gitignored `.env` and nowhere else — not in
  `.env.example`, not in a commit, not in a PR description. Gmail also caps sends at roughly 500/day,
  which is a testing tool, not a delivery channel.

- `MAIL_ENABLED=true` in a developer `.env` used to be enough to make `npm run test:e2e` send real
  mail: `test/setup-e2e-env.ts` loads `dotenv/config`, and the e2e harness overrides
  `FaceAuthClientService` and `DvrClientPort` but not `CredentialDeliveryPort`. That setup file now
  forces the switch off. Any new harness that boots `AuthModule` must do the same.

## Frame annotation

- **The confidence tag needs a font on the host.** `sharp` composites the detection boxes from an
  SVG, and the `%` label inside it is rendered by librsvg through fontconfig — which uses the
  _host's_ fonts, not something the package ships. A deploy target with no font packages installed
  draws the green box and the filled tag and leaves the tag empty. `fc-list | head` on the host says
  whether there is anything to render with; `fonts-dejavu-core` is enough. The failure is silent and
  only visible in the delivered mail, which is why the label sits on a filled rectangle: an empty
  tag still marks the detection.
- **Re-encoding changes the frame size.** The annotated JPEG is written at quality 88 and typically
  lands within ~20% of the captured bytes, but it can grow. A frame that was just under
  `SNAPSHOT_MAX_BYTES` can be refused after annotation; the pipeline retries that write with the
  frame as captured rather than dropping the evidence.

## Measuring detection recall

- **`scripts/try-detect.ts` takes a directory, not just a file.**
  `npx ts-node scripts/try-detect.ts <dir> [gapMs]` posts every `.jpg`/`.jpeg`/`.png` in it to the
  upstream and prints one TSV row per frame plus a summary: how many frames came back with a
  detection, and the `detScore` range. It boots Nest and goes out over the real
  `FaceAuthClientService`, so the session-token exchange, the breaker and the throttle park are the
  ones production uses, and the scores are the raw `persons[]` — the confidence filter lives in
  `PipelineService`, not in the client.
- **Pace it, or the measurement measures the rate limiter.** The upstream is IP-throttled: 250 ms
  spacing drew a `429` after ~17 requests and then a 15–45 s penalty window, while 12 s ran 35
  requests clean. The script clamps the gap to 5 s minimum and defaults to 12 s, and it is worth
  remembering that the running app is already spending roughly one detect call every three seconds.
- **Ground truth has to come from looking at the frames.** Recall is only meaningful against frames
  where somebody is known to be present, so mark that by hand before trusting a percentage. The
  measured baseline to compare against — 6/8 at close range in daylight, 0/11 on the street
  cameras, 1/33 on an IR night scene — is in
  [`plans/05.detection-quality.md`](../plans/05.detection-quality.md) §2.
- **Evidence rows are the annotated re-encode.** Re-running history against the upstream is a lower
  bound unless `SNAPSHOT_KEEP_RAW` was on when the alert fired, because the stored frame carries
  burnt-in boxes and a q88 round trip.

## Observability (local)

- Traces need a collector listening, and there is no container for it: it is a PM2 process from
  [`ops/otel-collector/`](../ops/otel-collector/README.md). `scripts/install.sh` once, then a `.env`
  with `OTELCOL_MODE=debug`, then `scripts/start.sh`. Debug mode prints every span with
  `verbosity: detailed` **and** ships it to Grafana Cloud, so `pm2 logs
tu-seguridad-otel-collector` is the whole tool for reading one trace. `OTELCOL_MODE=test` needs no
  Grafana credentials at all.
- **`OTEL_ENABLED=true` in the app's `.env` is the other half.** With the collector up and the switch
  off, or the switch on and no collector, nothing arrives — and the second case looks worse than it
  is: the OTLP exporter retries and fills the log with export failures. `scripts/check-health.sh`
  checks both halves.
- **Quote the Grafana auth header** in the collector's `.env`:
  `GRAFANA_CLOUD_OTLP_AUTH_HEADER="Basic <base64>"`. The scripts `source` that file, so the space in
  `Basic <base64>` unquoted assigns `Basic` and then tries to run the base64 as a command. The error
  it produces names the variable as missing, which points nowhere near the quoting.
- The face-api collector on this machine listens on the same `127.0.0.1:4318`. Two collectors cannot
  both bind it, and they do not need to: in dev, whichever one is up serves both APIs, and
  `service.name` keeps the two services apart in Grafana. In prod they are different hosts, which is
  why this repo has an instance of its own.

## Infra / CI (plan 02)

- **`npm audit` gate scope.** CI runs `npm audit --omit=dev --audit-level=critical`, not `--audit-level=high` on the full tree. Advisory DB updates constantly → full-tree `high` gate turns red on unrelated PRs the moment a new transitive advisory lands (it happened — 30 new `high`s, all dev tooling + transitive prod, 0 critical, appeared days after a green run). Dev-tooling vulns (jest/babel/etc.) never ship; high transitive prod advisories are Dependabot's job. Gate blocks only production-dependency **critical** severity. If it ever fires, fix the dep — don't widen `--audit-level` or `|| true` it.
- **The three `high` advisories the gate lets through, and why they stay.** `npm audit fix` cleared the `brace-expansion` and `js-yaml` ones (the second reached through `@nestjs/swagger`, which now resolves `js-yaml@4`). What is left is one advisory counted three times: `deepmerge-ts` stack exhaustion, reached through `@prisma/config` and `prisma`, which `@prisma/client` depends on — so it is in the production tree even though the CLI is not loaded by the running server. The only offered fix is `npm audit fix --force`, which **downgrades** `prisma` from 6.19.3 to 6.12.0; that is a worse tree, not a safer one. The vulnerable path merges Prisma's own config files, which this repo authors — nothing an attacker supplies reaches it. Re-check on the next Prisma minor; do not downgrade, and do not widen the gate to make it visible.
- **OpenAPI export replicates `main.ts` by hand.** `scripts/export-openapi.ts` re-implements `main.ts`'s `setGlobalPrefix(... exclude ...)` + `enableVersioning(...)`. Change prefix/versioning/excludes in one and not the other → `openapi.json` drifts from `/docs-json` and CI's diff check fails. (The standard's fix for this class of bug is a single shared `configureApp(app)`; this repo has not extracted one yet.)
- **Stacked-PR CI can show stale red.** Reopening a PR (or force-pushing while its base branch changed) can leave `gh pr checks` pointing at an old run computed on a **stale merge-ref** — e.g. a run that still executed a workflow step the current branch no longer has. Current merge-ref is what matters: `git fetch origin '+refs/pull/<n>/merge:refs/remotes/pr/<n>/merge'` and inspect it. To force a genuinely fresh run on the correct merge-ref, change the head sha (`git commit --amend --no-edit` + force-push), not just reopen.

Agent duties are central ([`.standards/AGENTS.md`](../.standards/AGENTS.md)); this repo's session workflow and plan-tracker convention are in [`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](../CLAUDE.md).

## DVR motion events (recorder side)

Verified against a Hikvision DVR-208G-M1 on firmware V4.71.410. Everything here was learned by
running it, not by reading a datasheet.

- **`POST /dvr/event-linkage` wires the notification. It does not enable motion detection.** These are
  two independent settings, and this is the most confusing failure the feature can produce: a channel
  whose detection grid is off is reported `linked` and stays silent forever, with nothing visible from
  the API to say why. Check it per channel:
  `curl --digest -u USER:PASS 'http://DVR/ISAPI/System/Video/inputs/channels/<N>/motionDetection'` —
  you want `<enabled>true</enabled>` and a grid that actually covers the frame.
- **Check which BNC ports carry video before concluding anything is broken.** The first walk test on
  this recorder failed for the dullest possible reason: channel 1 is an empty socket. `resDesc` reads
  `NO VIDEO` on an unwired port —
  `curl --digest -u USER:PASS 'http://DVR/ISAPI/System/Video/inputs/channels' | grep -E '<id>|resDesc'`.
- **A `PUT` to a trigger's `/notifications` replaces the whole list.** A document composed from scratch
  silently deletes the operator's record-on-motion and light-on-motion linkages — the recorder answers
  `OK` and quietly stops recording when somebody walks in. A hand-rolled `curl` must `GET` first and
  send back the recorder's own document with the one block added. The endpoint does exactly that.
- **`<statusCode>1</statusCode>` is not proof.** This firmware answers `OK` to a write whose elements
  it silently dropped. Only a re-`GET` shows whether the change stuck.
- **Capability discovery exists, but not on the trigger endpoint.**
  `GET /ISAPI/Event/triggers/VMD-1/capabilities` answers `statusCode 4` / `Invalid Operation` /
  `notSupport`, so nothing can ask which notification methods a trigger accepts. Other endpoints do
  answer — `GET /ISAPI/System/Video/inputs/channels/<N>/motionDetection/capabilities` returns the
  allowed values inline, e.g. `<targetType opt="human,vehicle">`. Check per endpoint rather than
  assuming either way.
- **Motion detection classifies targets, and the only two values are `human` and `vehicle`.**
  `<targetType>human</targetType>` is accepted and persists. An empty `targetType` is answered `OK`
  and then vanishes from the document — the silent-drop behaviour again — so there is no verified way
  to ask for unclassified pixel motion. Narrowing to `human` is not obviously a win: the recorder's
  classifier is the first of two filters in front of the detector, and a person it fails to classify
  produces no event at all, so the frame is never looked at. Measure the event mix per channel over a
  night before dropping `vehicle`.
- **The digest signature covers the HTTP verb.** HA2 is `METHOD:uri`, so a write signed as a read is
  refused — and refused as a `401`, which reads like a rejected password rather than a malformed
  signature. If a new ISAPI write ever fails with a credential error against credentials that work,
  this is the first thing to check.

### Two axios findings, measured

Both were reproduced against a fake infinite multipart server, not inferred.

- **`maxContentLength` is fatal on a long-lived stream.** On axios 1.18.1, `maxContentLength: 1000`
  killed the connection at 894 bytes with `maxContentLength size of 1000 exceeded`; omitted and
  `Infinity` both streamed indefinitely. axios wraps a stream response in a generator that throws once
  the running total passes the cap. Reusing `MAX_LISTING_BYTES` on `alertStream` — the obvious way to
  "harden" it later — would drop the socket after roughly five hours at this recorder's ~525-byte,
  9.5-second heartbeat: overnight, silently, looking exactly like a network fault. The byte cap belongs
  in the parser instead, and it is there.
- **An axios `timeout` is disarmed once the response headers land.** It therefore does not protect a
  stream that later goes quiet. `DvrEventListener` arms its own watchdog before the connect, covering
  the TCP connect, the headers and the idle period from one timer.

## Measuring against recorded video (recorder playback)

The recorder keeps **continuous** video (`CMR`, all week) going back **at least three weeks** at 10 fps.
That is a labelled dataset nobody has to collect: any past moment can be re-analysed. The recipe,
verified 2026-09-10.

**1. Find the segment and its playback URI.** Track ids are `<channel>01` — channel 8 is `801`.

```bash
curl -s --digest -u admin:"$PASS" -X POST \
  'http://192.168.1.250/ISAPI/ContentMgmt/search' \
  -H 'Content-Type: application/xml' --data-binary '<?xml version="1.0" encoding="UTF-8"?>
<CMSearchDescription><searchID>{A1B2C3D4-1111-2222-3333-444455556666}</searchID>
<trackIDList><trackID>801</trackID></trackIDList>
<timeSpanList><timeSpan>
<startTime>2026-09-09T23:11:00Z</startTime><endTime>2026-09-09T23:12:00Z</endTime>
</timeSpan></timeSpanList>
<maxResults>5</maxResults><searchResultPostion>0</searchResultPostion>
<metadataList><metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor></metadataList>
</CMSearchDescription>'
```

Note `searchResultPostion` — the misspelling is the device's, and the correct spelling is rejected.
The reply carries `<playbackURI>` with `starttime`/`endtime` already filled in.

**2. Pull frames.** The URI needs credentials injected and TCP transport:

```bash
ffmpeg -rtsp_transport tcp \
  -i "rtsp://admin:$PASS@192.168.1.250:554/Streaming/tracks/801/?starttime=20260909T231120Z&endtime=20260909T231140Z" \
  -vf fps=2 -frames:v 40 -q:v 3 out/f_%03d.jpg
```

Frame _N_ maps to `starttime + (N−1)/fps`, and the mapping can be checked against the timestamp the
recorder burns into the image. 2 fps is enough — detections come in contiguous half-second runs, so
denser sampling buys nothing.

**3. Score them.** `scripts/try-detect.ts` takes a directory and prints a TSV plus a summary:

```bash
npx ts-node scripts/try-detect.ts out/
```

The optional second argument is the gap in ms; it defaults to 2 000 and the script clamps to a 1.5 s
floor. **The limit is 1 request/second per IP**, so 2 s carries half again the stated rate as margin
and a 40-frame event costs about eighty seconds. The floor was 5 s while the limit was unknown, which
made the same event eight minutes and a ten-event sample unaffordable.

**Time zones:** the recorder's `dateTime` fields carry no offset and its search accepts a `Z` suffix
while treating the values as local. Use the same wall-clock the recorder prints and do not convert.

### What the search will not give you

`ContentMgmt/search` returns **one continuous block**, never per-event segments, because the recorder
records continuously rather than on motion. There is no `preRecordTimeSeconds` on the track, and the
Hik-Connect app's per-event clip is a fixed 2 m 10 s pad from the event timestamp, not a measured
boundary. `POST /ISAPI/ContentMgmt/logSearch` refused four different body shapes with
`Invalid XML Content`; whether a device log is reachable is unverified. **The analysis window is ours
to choose** — which is an advantage, since continuous recording is what allows sampling the seconds
around a notification rather than only after it.

**And it will not give you a still image from the past, however much it looks like it does.**
`GET /ISAPI/Streaming/channels/<track>/picture?playbackTime=<ISO>` answers **`200 image/jpeg`** with a
perfectly valid photograph — of _now_. Asked for 2026-09-09T23:11:22Z in daylight hours the next day,
it returned the live frame, burned-in clock reading the current time. The parameter is silently
dropped, which is the same firmware behaviour documented above for writes, and here it is worse:
there is no re-`GET` that reveals it, only the timestamp inside the image. Two other shapes were
tried — `/ISAPI/Streaming/tracks/<track>/picture` and `/ISAPI/ContentMgmt/playback/picture` answer
`404`, `/ISAPI/ContentMgmt/record/tracks/<track>/picture` answers `403`.

**So decoding recorded video is the only way to get frames out of the past, and that means ffmpeg.**
Worth knowing before reaching for alternatives: MediaMTX does not avoid it — the project's own
documented recipe for extracting stills (`docs/2-features/13-extract-snapshots.md`) is to run ffmpeg
inside a `runOnAvailable` hook. It is a media server; it has no still-image endpoint. What MediaMTX
does offer is a deployment answer: `bluenviron/mediamtx` publishes a `<version>-ffmpeg` image tag, and
that service is already in `docker-compose.yml`. Note also that
[`docs/decisions/002-hls-live-streaming.md`](decisions/002-hls-live-streaming.md) rejected ffmpeg as a
_live transcoder_, on cost-per-stream grounds — it says nothing about offline frame extraction, which
is a different workload.
