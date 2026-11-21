# T00 — Does sampling more frames change the answer?

**Measured:** 2026-09-10, against the live recorder and the live detector.
**Question:** [`plans/07`](../plans/07.playback-backfill.md) rests on the conjecture that analysing
many frames around a motion event beats analysing the one frame taken after it.

**Status: settled. The decision rule is met, and one of the pilot's own conclusions is overturned.**
Eleven events across three cameras, day and night. The plan's DoD asked for ≥10 across ≥2.

---

## The answer, first

| How the frames are chosen                         | Events with a detection | …that survive `CONFIDENCE_THRESHOLD` |
| ------------------------------------------------- | ----------------------- | ------------------------------------ |
| **1 frame at T+0** — what the live path takes now | **2 / 10**              | **1 / 10**                           |
| **20 frames, `[T − 10 s, T + 0 s)`**              | **7 / 10**              | **4 / 10**                           |
| 40 frames, `[T − 15 s, T + 5 s]`                  | 7 / 10                  | 4 / 10                               |

`plans/07` fixed the rule in advance: _if 20 frames do not at least double the single-frame hit rate,
the backfill is not built._ Twenty frames take it from 2/10 to 7/10 — **3.5×**, and 4× counting only
detections we would keep. **The rule is met. T02 is justified.**

The second line matters as much as the first: **the extra twenty frames bought nothing.** Forty
frames found detections in exactly the same seven events as twenty did. The gain is in going from
one frame to twenty, not from twenty to forty.

---

## Method

Ten motion events drawn from the 187 in the overnight `alertStream` capture behind
[T02a](T02a-event-volume-measurement.md), chosen to spread across channels and across the day, and
**chosen without regard to whether the live capture succeeded on them** — a sample of successes
cannot measure what the current design misses.

Per event, following the recipe in [`BEST_PRACTICES.md`](BEST_PRACTICES.md):

1. `ffmpeg -nostdin -rtsp_transport tcp -i "rtsp://…/Streaming/tracks/<ch>01/?starttime=…&endtime=…"
-vf fps=2 -frames:v 40` → 40 frames at 2 fps covering **`[T − 15 s, T + 5 s]`**.
2. `npx ts-node scripts/try-detect.ts <dir>` — every frame through the real `FaceAuthClientService`.

Frame _N_ sits at `T − 15 s + (N − 1) × 0.5 s`. The window is deliberately **wider than the pilot
recommended**: measuring only the window the pilot proposed would have confirmed that proposal by
construction and never shown a hit outside it.

Raw TSVs: `docs/data/T00-ch*-*.tsv`, one per event, named by window start.

---

## Result, per event

| Event (channel @ notification) | Answered | Detections | Above 0.45 | Best  | Offsets of the hits (s)      |
| ------------------------------ | -------- | ---------- | ---------- | ----- | ---------------------------- |
| ch4 @ 17:28:35                 | 40       | 2          | 0          | 0.413 | −3.0, −2.5                   |
| ch8 @ 17:31:58                 | 40       | **0**      | 0          | —     | —                            |
| ch3 @ 17:34:33                 | 40       | 6          | 0          | 0.405 | −5.0 … −3.5, +4.0, +4.5      |
| ch3 @ 18:02:12                 | 40       | 15         | 9          | 0.689 | −8.5 … −6.5, −2.5 … −1.0, …  |
| ch4 @ 18:03:52                 | 40       | 1          | 0          | 0.262 | −1.0                         |
| ch4 @ 19:15:44                 | 40       | 9          | 3          | 0.543 | −15.0 … −12.0, −8.0, …       |
| ch3 @ 20:11:35                 | 40       | **0**      | 0          | —     | —                            |
| ch4 @ 21:46:00                 | 40       | 24         | 8          | 0.627 | −15.0 … −11.5, −8.0, −7.5, … |
| ch3 @ 23:35:25                 | 40       | **0**      | 0          | —     | —                            |
| ch4 @ 00:05:22                 | 40       | 16         | 5          | 0.569 | −15.0 … −11.5, …             |

**400 frames, 400 answered, no upstream failures.** (The pilot saw one HTTP 500 in 40; this run saw
none in 400. The 2.5% figure reported to face-auth was a single observation.)

Pooled: **73 detections in 400 frames (18.2%)**, of which **25 (34%) score at or above the 0.45
threshold**.

---

## The offset curve — and what it overturns

Hit rate by position relative to the notification, pooled over all ten events:

```
  [-15.0, -12.5)   13/50   26%  #####
  [-12.5, -10.0)   10/50   20%  ####
  [-10.0, -07.5)    8/50   16%  ###
  [-07.5, -05.0)    5/50   10%  ##
  [-05.0, -02.5)    8/50   16%  ###
  [-02.5, +00.0)   12/50   24%  #####
  [+00.0, +02.5)    9/50   18%  ####
  [+02.5, +05.0)    8/50   16%  ###
```

**Before the notification: 18.7%. At or after it: 17.0%.**

**This overturns the pilot.** On the single event measured first (ch8 @ 23:11:27, kept below), the
three best scores landed five seconds _before_ the notification and **25 consecutive frames after it
detected nothing** — from which this document previously concluded that the recorder's classifier lag
"moves the sample out of the best part of the sequence and into the worst", and recommended
narrowing the window to `[T − 10 s, T + 2 s]`.

Across ten events that does not hold. The curve is close to flat: post-event frames detect very
nearly as often as pre-event ones. The pilot's event was one subject walking out of frame, and its
barren tail was that subject leaving — not a property of the classifier's lag.

What survives from the pilot is the weaker and more useful claim: **the frame the live path happens
to take is a poor draw**, and more frames anywhere in the neighbourhood beat it.

### Which twenty frames

Since twenty frames are as good as forty, placement is the only remaining question:

| 20-frame window       | Events with a hit | Above threshold |
| --------------------- | ----------------- | --------------- |
| `[T − 15, T − 5)`     | 4 / 10            | 4 / 10          |
| `[T − 12.5, T − 2.5)` | 6 / 10            | 4 / 10          |
| **`[T − 10, T + 0)`** | **7 / 10**        | **4 / 10**      |
| `[T − 7.5, T + 2.5)`  | 6 / 10            | 2 / 10          |
| `[T − 5, T + 5)`      | 7 / 10            | 2 / 10          |
| `[T + 0, T + 10)`     | 4 / 10            | 1 / 10          |

**`[T − 10 s, T + 0 s)` at 2 fps.** It ties the full forty-frame window on both counts, and it is the
only twenty-frame window that does. Windows starting at or after the notification are the worst of
the six — so the pilot's directional instinct was right even though its numbers were not.

---

## Two findings that are not about the window

**1. Our own threshold discards two thirds of what the detector finds.** Only 25 of 73 detections
reach `CONFIDENCE_THRESHOLD` (0.45). Three events — ch4 @ 17:28, ch3 @ 17:34, ch4 @ 18:03 — produced
detections where **every one** was below it. Those events land in the pipeline as `filtered`, not
`empty`, so [T01's recall ledger deliberately does not keep them](../plans/07.playback-backfill.md).
That is the right call for the ledger, and it means the ledger will understate the problem: the
detector saw these people and we threw them away. Whether 0.45 is the right number is its own
measurement, and a cheaper lever than any amount of backfill.

**2. Three events in ten produced nothing at all in twenty seconds.** ch8 @ 17:31:58 in daylight, and
ch3 @ 20:11:35 and ch3 @ 23:35:25 at night. The recorder classified motion; the detector found nobody
in forty consecutive frames. These are the labelled misses T01 exists to collect, and they are 30% of
events.

---

## What this still cannot say

- **The window may want to start earlier than −15 s.** The busiest bucket is `[−15.0, −12.5)`, at the
  very edge of what was sampled. Four of the ten events have their first hit in the first frame of the
  window. There may be more before it; this run cannot see it.
- **Whether the sampled events are representative.** They are drawn from one night on one estate, and
  three of five wired channels never fired at all that night (see T02a).
- **What a detection is worth.** This counts frames with a person in them, not alerts correctly
  raised. Whether a hit lands inside a monitored area is the pipeline's zone test, untouched here.

---

## The pilot, kept for the record

The first measurement, 2026-09-09 23:11:27 on channel 8, at 5 s spacing over `[T − 7 s, T + 12.5 s]`.
Raw TSV: `docs/data/T00-ch8-20260909T231120.tsv`.

```
frames answered   39/40
with a detection  6/39 (15%)
detScore range    0.388 – 0.883
upstream failures 1
```

Six detections, all between 23:11:20.0 and 23:11:27.0, the best three (0.809 / 0.883 / 0.847) five to
six seconds before the recorder published; then nothing across 25 consecutive frames. The live capture
succeeded on the 0.670 at 23:11:27, with about half a second of margin.

Its conclusions about **this event** stand. Its generalisation to the window shape does not, which is
the whole reason the plan asked for ten more.

---

## Next

The measurement is done and the rule is met, so T02 may be built. The open questions it hands over:

- **T02b** takes `[T − 10 s, T + 0 s)` at 2 fps, 20 frames — measured, not conjectured. It should
  widen backwards if a future sample shows hits before −15 s.
- **`stopOnFirstDetection` in chunks of 8** still fits: seven of ten events hit within the window, and
  a chunk that hits stops the rest.
- **`CONFIDENCE_THRESHOLD` deserves its own measurement** before more engineering goes into feeding
  the detector more frames.
