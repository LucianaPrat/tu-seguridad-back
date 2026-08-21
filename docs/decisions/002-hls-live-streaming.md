# 002 — Live streaming: RTSP into MediaMTX, HLS out

## Context

The dashboard needs moving video for a camera the operator is hovering over. Still frames already
exist and stay where they are: the configuration screens and the zone editor read the stored
snapshot, and `001-mysql-snapshot-storage.md` left live streaming explicitly undecided — "out of
scope until streaming protocol and authorization are decided". `plans/03.tenant-alert-data-model.md`
§7 deferred the same three things: protocol, authorization, and the stream URL contract. This
decides all three.

The constraints that pick the answer:

- The recorder is a Hikvision DVR-208G-M1. It publishes each channel over RTSP, and RTSP is the only
  live transport it has.
- No browser plays RTSP.
- `AGENTS.md` says the recorder password and the plaintext behind `Dvr.passwordEncrypted` never leave
  the process. An `rtsp://user:pass@host/...` handed to the frontend would break that, and would be
  unplayable there anyway.
- The frontend is a React SPA authenticated by bearer token only. It has no video library yet.

## Decision

**RTSP from the recorder to MediaMTX, HLS from MediaMTX to the browser, `hls.js` into a `<video>`.**
No transcoding while the channel is H.264 — MediaMTX repackages, it does not re-encode.

**The upstream is pulled only while somebody is watching.** MediaMTX does that itself for a static
source: `sourceOnDemand` starts the RTSP connection when the first reader asks for the playlist and
`sourceOnDemandCloseAfter` drops it once the last reader leaves. So "on demand" costs a config flag
and no process management.

**This API never touches a media packet.** It does three things:

1. Authorizes the camera against the caller's space.
2. Registers the path with MediaMTX's Control API — `POST /v3/config/paths/replace/{name}` with the
   RTSP source. `replace` rather than `add` because `add` fails on an existing path and the second
   viewer of a camera is the normal case, not an error; replace makes the call idempotent with no
   read first.
3. Answers `{ protocol, url }`.

The recorder password does reach MediaMTX, because nothing else can open the RTSP connection. It
reaches it the same way it already reaches the recorder: over a private link, from this process, in
a request nobody logs. What it never reaches is the browser.

**`protocol` is in the response from the first version** so a second transport is a new value there
rather than a second endpoint.

### Authorization: the path name is not the secret

The path name is the camera id, and nothing about the URL grants access. MediaMTX runs with
`authMethod: http` and `authHTTPAddress` pointed at `POST /api/v1/streaming/authorize`, so it asks
this API to authorize the playlist and **every segment**. `hls.js` attaches the caller's ordinary
access token through `xhrSetup`, MediaMTX forwards it in the `token` field of its hook payload, and
the hook validates it with `verifyAccessToken` — the same verifier the bearer guard uses, so the two
cannot drift.

Three consequences worth stating:

- **Nothing new is minted.** No stream token, no TTL bookkeeping, no expiry the caller has to renew.
  The access token is the clock, and the frontend already refreshes it.
- **No secret in a URL.** The credential travels in a header, so it stays out of access logs and
  `Referer`.
- **Only `read` over `hls` is ever authorized.** A granted `publish` would let a caller push their
  own video into a camera's path and the dashboard would render it as that camera's feed. The action
  is checked before the token is even looked at.

The hook is `@Public()`, because the media server holds no session of ours and the token arrives in
a body where no guard can reach it. That makes it an authorization oracle, so: a `200` means "this
token is valid and names a camera in its own space", which is exactly what `GET /cameras/:id`
already tells the same caller. It discloses nothing a token holder did not already have.

### Two knobs instead of two columns

RTSP is a different service on a different port from the stored ISAPI base URL, and the channel id
differs too — `/Streaming/Channels/302` is BNC port 3, sub-stream. `DVR_RTSP_PORT` (554) and
`DVR_RTSP_STREAM` (`sub`) are env vars rather than `Dvr` columns because a space owns exactly one
recorder today and none of them moves 554. The second recorder promotes them to columns.

The **sub-stream** is the default: the dashboard plays this in a hover-sized box, and the recorder's
uplink carries every viewer — roughly 0.5–1 Mbps per stream against 2–4 for the main one. `main` is
there for the day a full-frame view needs the native resolution.

## Alternatives rejected

- **Return the RTSP URL to the browser.** Breaks the credential rule and no browser can play it.
- **MJPEG `multipart/x-mixed-replace` from this API.** Would work with a plain `<img>` and need no
  media server, but `<img>` sends no `Authorization` header, so it forces a token into the query
  string; and it holds one Node connection plus one digest loop per viewer.
- **Polling the snapshot route faster.** Already available and honest for a thumbnail, but it is one
  frame per request against a BLOB, and it is not video.
- **ffmpeg transcoding.** Only needed if a channel is not H.264. Costs CPU per stream, so it stays
  unbuilt until a channel demands it.
- **A capability URL — random path name plus a TTL.** Simpler than the auth hook: no MediaMTX auth
  config, no per-segment call. Rejected because the secret then lives in the URL, and the hook it
  avoids is about thirty lines.

## Consequences

- **Off by default.** `MEDIAMTX_ENABLED=false` makes `GET /cameras/:id/live` answer `CONFLICT` and
  contacts nothing, the same posture as `OTEL_ENABLED` and `MAIL_ENABLED`. Local dev and CI need no
  media server.
- **MediaMTX's Control API takes recorder credentials and authenticates nobody.** It must never be
  bound to a public interface. `MEDIAMTX_API_URL` defaults to loopback for that reason.
- **`source` is in `SENSITIVE_FIELD_NAMES`.** MediaMTX names a path's upstream `source`, and for us
  that upstream holds the recorder password. The publish call is outbound so `pino-http` never sees
  it, but an axios error carries the request body it was sent with — hence the entry, and hence
  `publish` returning `Either` rather than letting anything throw with that body attached.
- **The authorization hook must declare every field MediaMTX sends.** The global pipe runs with
  `forbidNonWhitelisted`, so one undeclared field turns the hook into a `400` and MediaMTX, seeing
  anything but `200`, denies every viewer. A field added by a future MediaMTX release lands in
  `StreamAuthorizationDto` in the same change that upgrades it. There is an e2e canary for this.
- **Latency is HLS latency** — several seconds with stock segment sizes. Accepted deliberately;
  MediaMTX's Low-Latency HLS brings it to roughly 2–3s and is a flag, not code.

## Still open

- **Reachability.** The recorder sits on a home LAN behind NAT and a MediaMTX in AWS cannot see it.
  Today the API and the media server run on that same LAN, which is why this ships working. Exposing
  port 554 to the internet is not the fix — these recorders are scanned for continuously and this
  firmware is old. A tunnel (WireGuard, Tailscale) between the recorder's network and the VPC is,
  and it is infrastructure rather than code.
- **Codec verification.** Passthrough holds only while the channel is H.264. Unverified on the bench:
  `ffprobe rtsp://…/Streaming/Channels/302`.
- **Nothing removes a path.** A camera published once keeps its MediaMTX path after it is logically
  deleted. The path is inert — the hook refuses every reader whose camera no longer resolves — but it
  accumulates in the media server's config.
