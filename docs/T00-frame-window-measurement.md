# T00 — Does sampling more frames change the answer?

**Measured:** 2026-09-10, against the live recorder and the live detector.
**Question:** [`plans/07`](../plans/07.playback-backfill.md) rests on the conjecture that analysing
many frames around a motion event beats analysing the one frame taken after it. This is the first
measurement of that curve.

**Status: n = 1.** One event, one camera, one night. The result is strong enough to act on and far
too small to generalise from. The plan's DoD asks for ≥10 events across ≥2 cameras; this is the first.

---

## Method

Channel 8, the motion event of 2026-09-09 23:11:27 — a real person, verified by eye in the frames.

1. `POST /ISAPI/ContentMgmt/search`, track `801`, for the twenty seconds around the event → `playbackURI`.
2. `ffmpeg -rtsp_transport tcp -i "<uri>" -vf fps=2 -frames:v 40` → 40 JPEG frames, 960×1088,
   covering **23:11:20.0 → 23:11:39.5** at half-second spacing.
3. `npx ts-node scripts/try-detect.ts /tmp/pb 5000` — every frame through the real
   `FaceAuthClientService`, 5 s apart.

Frame-to-clock mapping confirmed against the recorder's burned-in timestamp: `f_015` reads
`23:11:27`, so frame _N_ = `23:11:20 + (N−1)×0.5 s`.

---

## Result

```
frames answered   39/40
with a detection  6/39 (15%)
detScore range    0.388 – 0.883
upstream failures 1
```

| Frame         | Clock             | detScore                        |
| ------------- | ----------------- | ------------------------------- |
| f_001         | 23:11:20.0        | 0.388                           |
| f_002         | 23:11:20.5        | 0.634                           |
| f_003         | 23:11:21.0        | **upstream 500**                |
| f_004         | 23:11:21.5        | 0.809                           |
| f_005         | 23:11:22.0        | **0.883**                       |
| f_006         | 23:11:22.5        | 0.847                           |
| f_007 – f_014 | 23:11:23.0 – 26.5 | none                            |
| **f_015**     | **23:11:27.0**    | 0.670 ← the event fires here    |
| f_016 – f_040 | 23:11:27.5 – 39.5 | **none, 25 consecutive frames** |

Split by position relative to the notification:

| Window           | Answered | Hits | Rate    |
| ---------------- | -------- | ---- | ------- |
| Before the event | 13       | 5    | **38%** |
| At the event     | 1        | 1    | —       |
| After the event  | 25       | 0    | **0%**  |

---

## What it says

**1. The live capture succeeded, with about half a second of margin.** The pipeline logged
`saw 1 person(s)` at 23:11:27.231, matching `f_015`'s 0.670. It was not a miss. But every frame from
23:11:27.5 onward — twelve and a half seconds of them — detects nothing, so a capture arriving one
second later would have found an empty scene and this event would have gone unrecorded with no trace
that anything was missed.

**2. The best frames are all before the notification.** 0.809, 0.883 and 0.847 land between 23:11:21.5
and 23:11:22.5 — five to six seconds before the recorder published, and roughly 0.2 higher than what
the live capture got. The recorder's classifier lag is not merely a delay: it moves the sample out of
the best part of the sequence and into the worst.

That matters beyond hit-or-miss. `confidence` is stored on the alert, and the detection's foot-point
anchor is what the zone test uses. A cleaner box is a more trustworthy anchor. This event confirmed
no monitored area (`0 area(s) confirmed`), on the weakest of the six detections available.

**3. The detectable window was about 2.5 seconds wide.** Roughly 23:11:20 to 23:11:22.5, then a gap,
then one frame. The subject stayed in view — what changed is the pose and angle the detector can
work with. A poll landing anywhere else in the twenty seconds sees nothing.

At the pre-`plans/06` cadence of one frame per 15 s, the chance of landing in that window was about
one in six. At the current 300 s watchdog rung, about one in 120.

**4. Our own threshold would drop one of the six.** `CONFIDENCE_THRESHOLD` defaults to 0.45 and
`f_001` scored 0.388, so five of six survive filtering. Not a problem here; worth knowing before
anyone reads "6 detections" as "6 usable detections".

**5. One frame in forty returned HTTP 500.** `f_003`, at 23:11:21.0 — inside the strongest part of the
cluster, between a 0.634 and a 0.809. A 2.5% failure rate is worth reporting to face-auth on its own,
and it is a reason a batch endpoint should fail per image rather than per request, which
[`face-auth-batch-endpoint-request.md`](face-auth-batch-endpoint-request.md) §4.2 already asks for.

---

## Against the decision rule

`plans/07` fixed the rule in advance: _if 20 frames do not at least double the single-frame hit rate,
the backfill is not built._

The first 20 frames contain 6 detections against a single post-event frame's 0. The rule is met on
this event by any reading of it.

**It is still one event.** What this justifies is continuing to measure, not shipping a backfill.

---

## What changes in the plan

- **The window is not symmetric.** Weight it before the event: `[T − 10 s, T + 2 s]` would have
  captured all six detections here, at 24 frames instead of 40. The earlier draft's `[T − 20 s, T + 10 s]`
  spends most of its budget on the half of the window that produced nothing.
- **`stopOnFirstDetection` in chunks of 8 fits this shape well.** The first chunk of a pre-event
  window would have hit on this event, so the common case costs one chunk.
- **Sampling denser than 2 fps is probably wasted.** The hits are contiguous half-second frames; the
  scene does not change fast enough to reward 5 or 10 fps.

## Next

Nine more events, at least one more camera, and some daylight. Two of them should be events where the
live capture found **nothing** — this one succeeded, and a sample of successes cannot measure what the
current design misses.
