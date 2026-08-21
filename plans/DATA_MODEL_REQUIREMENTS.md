<!--
Data requirements the frontend screens imply. Input for backend schema design.

Not a schema decree: backend owns tables, types, keys, migrations. This file says what data
the UI reads and writes, and which rules the screens already assume.

Screens and product copy: ui.md. Current fixture shapes: src/data/mockData.ts.
Layering and auth token placement: ARCHITECTURE.md.
-->

# Data Model Requirements

## Scope

Derived from screens in `src/pages/`, fixtures in `src/data/mockData.ts`, spec in `ui.md`.
Everything below is live in UI today, mock-backed except auth.

## Tenancy

`space` is tenant root. User registers, then MUST initialize DVR before dashboard reachable
(`RequireDVR` gate, hard redirect). Space holds one DVR today. Cameras, zones, events, routing,
members all hang off space. A space has many users; a user belongs to exactly one space.

## Entities

### user

Screens: Register, Profile, Members, alert recipients.

- id, email (unique, citext or lowercased), password_hash
- first_name, last_name, phone (E.164; used for call + whatsapp channels)
- avatar_url (nullable; Profile uploads file, needs storage target)
- is_active (Members badge), last_login_at (Members column)
- profile_completed (invited user auto-logs in, MUST complete name/lastname/phone before dashboard)
- created_at, updated_at

Email uniqueness global, not per space.

### space

- id, name (`spaceName`, "Mi Espacio Seguro"), owner_user_id, created_at

### space_member

Join user to space. Membership-scoped, not user-scoped.

- space_id, user_id, role, receive_alerts (bool, toggled in Canales de comunicación)
- invited_by_user_id (nullable), joined_at
- unique (space_id, user_id)

`receive_alerts` belongs here, not on user: same person in two spaces gets two answers.
Role values seen in UI: admin, member. `/auth/me` returns role as string today.

### invitation

Dashboard + Members "Invitar miembro" sends email only.

- id, space_id, email, token_hash, invited_by_user_id
- expires_at, accepted_at (nullable), created_user_id (nullable)
- index (space_id, email) for pending lookups

Flow: invite email carries magic link. Click auto-logs in, creates user, attaches to space,
lands on profile completion. Until `profile_completed`, no dashboard.

### auth_token

One table, discriminated by purpose, or three tables. Backend call.

- id, user_id, purpose (refresh | magic_link | password_reset)
- token_hash, expires_at, used_at, revoked_at, rotated_from_id (refresh rotation)
- user_agent, ip

Refresh token ships as HttpOnly cookie, never in JSON. Access token lives 15 min, memory only.
Face-Auth login has no schema yet — button exists, no endpoint.

### dvr

Screens: DVR init onboarding, DVR configuration.

- id, space_id, url (plain string, LAN hosts allowed, not validated as URL)
- username, password_encrypted, timezone (IANA id, e.g. `America/Argentina/Buenos_Aires`)
- last_test_at, last_test_ok, created_at, updated_at

Config edit warns camera configs may be lost. Backend decides whether re-init wipes cameras or
re-matches by DVR channel id. UI already shows the destructive-change confirm.

### camera

Screens: Dashboard grid, Camera monitor behavior.

- id, dvr_id, external_id (DVR channel identifier — the stable key, NOT name)
- name (operator-editable, defaults to DVR name), location
- status (online | offline; comes from DVR poll, not user input)
- is_configured (has monitor behavior saved), is_enabled (operator toggle; disabled group collapses)
- monitor_mode (full | partial)
- alert_type (nullable; alert level when mode = full, default for new zones when mode = partial)
- latest snapshot resource, last_snapshot_at (UI renders "5 min" from age, so send timestamp not
  string; backend stores image bytes and derives the authenticated URL from the snapshot id)
- created_at, updated_at
- unique (dvr_id, external_id)

Cameras are discovered from DVR, not created by user. Rediscovery MUST NOT orphan config —
match on external_id. If a channel no longer appears in DVR discovery, mark its camera as not
configured rather than deleting it.

### monitor_zone

Partial mode rectangles drawn over snapshot.

- id, camera_id, x, y, width, height, alert_type, deleted_at (nullable), created_at
- x/y/width/height are percent of image, 0..100, fractional (editor computes from bounding rect)

Percent not pixels on purpose: DVR resolution or snapshot size can change without invalidating
zones. Store as numeric(5,2). Constraint: x+width <= 100, y+height <= 100, width/height > 0.

Zones only meaningful when camera.monitor_mode = partial. Full mode uses camera.alert_type.

### alert_routing

Canales de comunicación, section 1. Matrix of alert type by channel, per space.

- space_id, alert_type, channel, enabled
- unique (space_id, alert_type, channel)

Today two alert types by three channels. Rows, not columns — new channel is data, not migration.

### event

Events history screen.

- id, space_id, camera_id (nullable on camera delete, or restrict), zone_id (nullable)
- camera_label_snapshot (what the UI prints: "Cámara 01 – Frente de casa")
- alert_type, detected_at, snapshot resource (nullable; backend maps its id to an authenticated
  URL, it does not persist an external URL)
- acknowledged_at, acknowledged_by_user_id (both nullable)
- index (space_id, detected_at desc), index (space_id, alert_type, detected_at desc)

Label snapshot is deliberate: camera renames MUST NOT rewrite history.
Filters in UI: alert type, and date lower bound. Expect pagination — table has no limit today.
Highest-volume table. Plan retention or partition by month.

### event_delivery

Events table shows one channel per event. Real routing can hit several channels and several
recipients, so a delivery row per attempt.

- id, event_id, channel, recipient_user_id, status (pending | sent | failed | delivered)
- correlation_id (unique, passed to the provider), sent_at, provider_message_id, error

If backend keeps one channel per event instead, say so — UI shape changes.

## Enums

- alert_type: intruder, suspicious
- channel: call, whatsapp, email
- camera_status: online, offline
- monitor_mode: full, partial
- role: admin, member

UI fixtures currently carry Spanish values (`intruso`, `sospechoso`, `llamada`). Recommend
English enum values on the wire, Spanish only in UI labels. Frontend maps. Decide before first
endpoint ships — changing it later touches every screen.

## Security notes

These are not style preferences.

- DVR password must be reversible-encrypted, not hashed: the backend has to replay it to the
  recorder. Use envelope encryption with the key outside the database (KMS or env-injected key),
  and never return the plaintext or the ciphertext through the API — return a masked value and
  accept writes only.
- User passwords: argon2id or bcrypt. Never reversible.
- All token columns (refresh, magic link, password reset, invitation) store a hash of the token.
  The raw token exists only in the email or the cookie.
- Magic link, password recovery and invitation endpoints must answer the same way for a
  registered and an unregistered email. The UI is written to never reveal which is which.
- Every query scoped by space_id. A camera id alone must never be enough to read an event.

## Resolved backend decisions

1. A user belongs to exactly one space. `space_member` remains the membership table for role and
   alert preferences, with a unique user membership constraint.
2. DVR rediscovery re-matches cameras by `external_id` and retains matching configuration. A
   channel missing from the DVR becomes not configured; it is not removed.
3. Snapshot thumbnails are stored as database BLOBs. The API derives an authenticated resource URL
   from the snapshot id. Live streaming was undecided when this was written; it is now RTSP into
   MediaMTX and HLS out (`docs/decisions/002-hls-live-streaming.md`), and it did not change the
   snapshot contract.
4. An inbound email reply or WhatsApp reply acknowledges the corresponding event through a unique
   correlation id sent with the outbound delivery.
5. Event deduplication/cooldown remains undecided.
6. Face Auth returns an opaque user identifier. The backend stores a hash in a revocable,
   one-to-many face-identity table linked to the user.
7. Camera discovery happens when DVR parameters are initialized or changed, and discovered cameras
   are persisted. Polling and DVR WebSocket/push remain alternative refresh transports; both must
   update the same records.
8. Cameras and monitor zones use logical deletion so normal reads omit them and event history
   remains intact.
