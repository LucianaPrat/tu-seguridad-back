# OpenTelemetry Collector

The collector this API exports its traces to. It receives OTLP on loopback and forwards to Grafana
Cloud; the API itself never talks to Grafana. Same shape as the face-api collector on purpose —
identical modes, scripts and PM2 layout — so knowing either one is knowing both.

Key points:

- The config lives in this repo, but the **deploy is manual**. `.github/workflows/deploy.yml` (plan
  02, T02) neither starts nor restarts the collector.
- It runs on the same host as the API, under `pm2`, as `tu-seguridad-otel-collector`.
- The API exports to `http://127.0.0.1:4318` (`OTEL_EXPORTER_OTLP_ENDPOINT`'s default) once
  `OTEL_ENABLED=true`. Off, or with no collector listening, the OTLP exporter just retries into the
  log — a "collector looks broken" report is that switch nine times out of ten.
- The version PM2 shows comes from `ops/otel-collector/package.json`, bumped by hand.
- Traces only. There is no metrics pipeline yet: `GET /metrics` (plan 02, T04) is exposed for a
  scraper that does not exist here, and wiring a `prometheus` receiver to it is separate work.

## Why its own instance, and not the face-api one

The face-api collector binds `127.0.0.1:4318` and its own docs declare loopback as a boundary. This
API deploys to a different host, so reusing that process is not a preference — it is unreachable.
Both instances point at the same Grafana Cloud tenant, which is enough: `service.name` tells the two
services apart, and a trace that crosses from here into face-auth is still stitched into one trace,
because the stitching happens in Tempo by `traceparent`, not in a collector.

In dev, both APIs run on one machine and one collector on 4318 serves both — two of them cannot bind
the same port anyway.

## Setup

1. `scripts/install.sh` — downloads the pinned `otelcol-contrib` into `OTELCOL_INSTALL_ROOT` and
   points `current` at it. Needs `sudo`.
2. Copy `.env.example` to `.env` and fill it. `.env` is gitignored (the root `.gitignore` entry has
   no slash, so it matches at any depth). **Quote the auth header**:
   `GRAFANA_CLOUD_OTLP_AUTH_HEADER="Basic <base64>"`. The scripts `source` this file, so the space
   in `Basic <base64>` unquoted sets the variable to `Basic` and then tries to run the base64 as a
   command — which fails as `GRAFANA_CLOUD_OTLP_AUTH_HEADER: missing`, pointing nowhere near the
   quoting.
3. Pick a mode with `OTELCOL_MODE`: `prod` (Grafana Cloud only), `debug` (Grafana Cloud **and**
   stdout, `verbosity: detailed`), `test` (stdout only, needs no credentials).
4. `scripts/validate-config.sh` — runs `otelcol-contrib validate` against the config the mode picks.
5. `scripts/start.sh` to start or restart it, `scripts/restart.sh` after a config change,
   `scripts/check-health.sh` to check the `health_check` extension on `127.0.0.1:13133`.

Reading one trace end to end without opening Grafana: `OTELCOL_MODE=debug`, then
`pm2 logs tu-seguridad-otel-collector`. Every camera poll is one `poll.camera` span with the DVR
`GET`s, `face-auth.detect` and the Prisma queries under it.

## Files

- `config/collector.prod.yaml` — production pipeline to Grafana Cloud.
- `config/collector.debug.yaml` — same, plus the `debug` exporter.
- `config/collector.test.yaml` — `debug` exporter alone, no credentials, fixed memory limits.
- `pm2/ecosystem.config.cjs` — the PM2 definition; `OTELCOL_BIN` is required and the mode selects
  the config.
- `scripts/lib.sh` — mode resolution, env loading and the fail-fast validation the other scripts
  share.
- `package.json` — the manually bumped version PM2 displays.

## Egress

The collector is the third channel that carries data out of this process, after the pino logs and
Sentry. The span attributes this API sets are `cameraId`, `spaceId` and `filename`, none of them
secret, and `attributes/sanitize` drops `db.statement`, request/response bodies and the user
identifiers as defence in depth. A new span attribute holding anything sensitive is treated like any
other secret-bearing field — see `SENSITIVE_FIELD_NAMES` in [`AGENTS.md`](../../AGENTS.md).

Grafana Cloud credentials are an owner step, like `SENTRY_DSN`: nothing in this repo carries them,
and `prod`/`debug` refuse to start without them.
