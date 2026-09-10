# DVR event capture — decisions taken alone, and what is still owed

Written while implementing [`plans/06.dvr-event-push.md`](../plans/06.dvr-event-push.md) without the
owner available. Everything here is either a judgment call that deserves a second opinion or a task
that could not be finished from a development machine. Nothing here blocks the branch.

## Decisions taken without asking

**`POLLING_PASSIVE_SECONDS` was made conditional rather than flat.** The plan said 15 → 300. A flat
change regresses any deployment that upgrades without turning events on — twenty times less
responsive with nothing replacing the poll. It is now
`.when(DVR_EVENTS_ENABLED, { is: true, then: default(300), otherwise: default(15) })`, verified
working on Joi 18.2.3 including the env string coercion. Precedent is `SWAGGER_ENABLED`. **Revisit
if** the conditional turns out to confuse more than it protects; the alternative is flat 300 plus a
release note.

**`DVR_EVENTS_DEBOUNCE_SECONDS` has a floor of 1, not 0.** Two design passes disagreed. `0` is
convenient on a bench, but the in-flight guard only bounds a camera to roughly one capture every
1.5 s — faster than the detection rung — and against an IP-throttled detector that is the `429` storm
already documented in `plans/05` §2.5. Safety won. **Revisit if** somebody actually wants
unthrottled bench runs; `1` is close enough that this is probably never.

**Reconnect timing is a module constant, the idle window is a variable.** The backoff cannot lose an
alert — the watchdog poll is underneath it — so there is nothing an operator would tune it against.
The idle window is different: it tracks a heartbeat interval the recorder chooses, and a different
model or firmware will beat at a different rate.

**`PollingScheduler.pollGuarded` became public** rather than adding a `pollOnMotion` method. The
alternative made the listener own a catch that either drops unexpected failures or re-implements the
status write and cadence re-arm, and would drift from the tick the first time either changed.

**The listener lives in `pipeline/`, not `dvr/`.** It needs `PollingScheduler`; the other direction
would be a cycle and a `forwardRef`.

**`POST /dvr/event-linkage` runs regardless of `DVR_EVENTS_ENABLED`.** The one deviation from this
repo's "off = CONFLICT" posture. The endpoint provisions the feature rather than being it, and the
linkage is inert without a listener; refusing would force flip-switch, restart, then link.

## Verified against the real recorder

Driven through the compiled adapter rather than curl, so the code under test is the shipped code.
Channel discovery, the idempotent path, the refused invalid channel, the stream opening and
classifying heartbeats, and — by stripping `center` from channel 2 and putting it back — the write
path, including that `record-2` and `whiteLightOut-2` survived. That last run is also the
real-hardware proof of the digest verb fix.

**Channel 2 was written to during this validation.** It is an empty socket, and it was left in the
same state it started in (`center` present, alongside the two original notifications).

## Still owed

### 1. A real motion event has not been observed through the shipped code

The linkage, the stream and the parser are all verified, and motion notifications were observed by
hand earlier in the session — but the end-to-end path _through `DvrEventListener` into a capture_ has
only been exercised against mocks. Nobody was available to walk in front of a camera during the final
validation.

**To close it**: set `DVR_EVENTS_ENABLED=true` and `POLLING_ENABLED=true`, walk past a wired channel
(3, 4, 5, 7 or 8) and expect a capture within a second or two, exactly one despite the four-to-five
pulse burst, `dvr_event_motion_total{outcome="triggered"}` up by one and `{outcome="debounced"}`
taking the rest.

### 2. `DVR_EVENTS_DEBOUNCE_SECONDS` is a guess

`5` matches the detection rung, which is a defensible default and not a measured one. The number that
should set it is **VMD notifications per hour per street camera with nobody there**, overnight.

**To close it**: leave the stream teed to a file for a night. The same log answers a second and more
valuable question — the timestamps at which the recorder classified a human — which can be crossed
against the alerts face-auth did _not_ raise. That is a free recall benchmark for the deferred plan,
at no labelling cost.

### 3. The silent-degradation failure has no alert

With the passive rung at five minutes, a channel whose `center` linkage is removed keeps heartbeating,
keeps the watchdog happy, and quietly degrades to a five-minute poll with no error anywhere. The only
signal is `dvr_event_motion_total` flatlining for that channel.

**To close it**: an alert rule on that series. It should be the first one written after this ships.

### 4. Concurrent-session pressure on the recorder is unmeasured

This class of box caps concurrent authenticated sessions in the single digits. A permanent
`alertStream` holds one, `POLLING_CONCURRENCY=4` can hold four, and RTSP viewers hold more. The
15 → 300 passive change is what makes room, but nobody has watched it under load.

**To close it**: watch `dvr_capture_total{outcome="error"}` on the first day with events on.

### 5. Event-only mode is undocumented behaviour

`DVR_EVENTS_ENABLED=true` with `POLLING_ENABLED=false` works, touches the recorder despite the polling
switch being off, and has no cadence escalation because no tick consumes the re-arm. It is not
blocked, and it is not described anywhere but here.

### 6. Two pre-existing issues were found and not fixed

- `.env.example` shipped `ENTER_CONSECUTIVE_POLLS=2`, removed from the schema by `plans/05` T03, and
  omitted its replacements. **Fixed in this branch** since it sat in the block being edited.
- `README.md`, `ARCHITECTURE.md` and `docs/BEST_PRACTICES.md` all fail `prettier --check` on
  `develop`, and still do. This branch leaves them no worse, confirmed against a stashed baseline.
  Reformatting them is a separate change: the diff would swamp any review it was attached to.
