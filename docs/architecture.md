# Communication map

Who talks to whom, over what, and who starts it. Every arrow points from the side that opens the
connection. Paths are relative to `/api/v1` unless they start with `/ISAPI`, `/v3` or a full URL.

Keep this file in step with the code (the component diagram is copied into `README.md`; change both): a PR that adds or changes a controller route, a gateway event,
an ISAPI call, a MediaMTX call or an outbound client updates the diagram in the same PR.

## Components

Arrow = who calls whom. Solid = HTTP request/response. Dashed = push.

```mermaid
flowchart LR
  WEB["Web"]
  API["Backend"]
  MTX["MediaMTX"]
  DVR["DVR"]
  FA["face-auth"]
  DB[("MySQL")]
  MAIL["SMTP"]

  WEB -->|HTTP| API
  WEB -->|HLS video| MTX
  API -.->|"socket.io (web not listening)"| WEB

  API -->|HTTP| MTX
  MTX -->|HTTP auth hook| API
  MTX -->|RTSP| DVR

  API -->|HTTP| DVR
  DVR -.->|motion events| API

  API -->|HTTP| FA
  API --> DB
  API --> MAIL

  LLM["LLM gateway<br/>chat, STT, TTS"]
  OTEL["OTel collector"]
  GRAF["Grafana Cloud"]
  SENTRY["Sentry"]

  API -->|HTTP| LLM
  API -->|OTLP traces| OTEL
  OTEL -->|OTLP| GRAF
  API -->|errors| SENTRY
```

The DVR's motion events ride a connection the backend opens and keeps open (`alertStream`); the
DVR never connects to the backend.

The bottom row is optional: each one is off unless its env is set (`ASSISTANT_ENABLED`,
`OTEL_ENABLED`, `SENTRY_DSN`), and the core flow does not depend on any of them. The collector is
our own process on the app host (`ops/otel-collector`) and ships **traces only**. The backend also
exposes `GET /metrics` for Prometheus, but nothing in this repo scrapes it, so metrics do not reach
Grafana today.

## Flow: motion on the recorder becomes an alert

```mermaid
sequenceDiagram
  autonumber
  participant DVR
  participant L as DVR event listener
  participant P as Pipeline
  participant FA as face-auth
  participant DB as MySQL
  participant G as socket.io /events
  participant M as SMTP
  participant UI

  L->>DVR: GET /ISAPI/Event/notification/alertStream (kept open)
  DVR-->>L: multipart part: VMD motion, channel n
  L->>P: pollGuarded(camera, 'event'), debounced
  Note over P: the polling tick reaches the same pollGuarded on its own cadence
  P->>DVR: GET /ISAPI/Streaming/channels/n01/picture
  DVR-->>P: JPEG (live frame)
  P->>FA: POST /api/v1/persons (JPEG)
  FA-->>P: persons detected
  P->>DB: snapshot + alert event
  P->>G: emit alert-event to room space:id
  G--xUI: nobody subscribed yet
  P->>M: alert email with acknowledge link
  UI->>P: GET /events (react-query, staleTime 30 s)
```

## Flow: live view

```mermaid
sequenceDiagram
  autonumber
  participant UI
  participant API
  participant MTX as MediaMTX
  participant DVR

  UI->>API: GET /cameras/:id/live
  API->>MTX: POST /v3/config/paths/replace/{name} (RTSP source)
  API-->>UI: {MEDIAMTX_PUBLIC_URL}/{name}/index.m3u8
  UI->>MTX: GET index.m3u8 (Bearer)
  MTX->>API: POST /streaming/authorize
  API-->>MTX: 200 (read over hls only)
  MTX->>DVR: RTSP pull /Streaming/Channels/n01
  MTX-->>UI: HLS fMP4 segments (each one re-authorised)
```

## Known gaps

- **Realtime.** The backend emits `alert-event` on `/events`, but the UI has no socket.io client. It
  sees new alerts only when react-query refetches `GET /events`.
- **Email links.** `smtp-credential-delivery.service.ts` builds `/auth/magic` and
  `/auth/reset-password`. The UI routes are `/auth/magic-link` and `/auth/change-password`.
- **Routes with no UI caller.**
  - face login: `/auth/face/*`
  - password reset and magic link: `/auth/password-reset/*`, `/auth/magic-link/*`
  - recorder setup: `/dvr/discovery`, `/dvr/event-linkage`
  - cameras: `DELETE /cameras/:id`, `/cameras/:id/status`, `/cameras/:id/analyze`
  - single records: `GET /zones/:id`, `/events/:id/deliveries`
