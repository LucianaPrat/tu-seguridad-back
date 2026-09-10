# T02a — How many motion events does the recorder actually produce?

**Measured:** 2026-09-09 17:28 → 2026-09-10 00:12, 6.7 hours of `alertStream` teed to a file.
**Why:** every cost estimate in [`plans/07`](../plans/07.playback-backfill.md) divided by a number
nobody had counted, and the debounce default was a guess.

This corrects three of my own estimates, two of them badly.

---

## Raw

```
records          2 723   (2 536 heartbeats, 187 VMD active)
span             6.7 h
channels firing  3 of 5 wired
```

| Channel | VMD active | Per hour |
| ------- | ---------- | -------- |
| ch4     | 96         | 14.3     |
| ch3     | 78         | 11.6     |
| ch8     | 13         | 1.9      |
| ch5     | **0**      | —        |
| ch7     | **0**      | —        |

By hour:

| Hour  | Events  |                                                          |
| ----- | ------- | -------------------------------------------------------- |
| 17:00 | 45      | `██████████████████████`                                 |
| 18:00 | **109** | `██████████████████████████████████████████████████████` |
| 19:00 | 9       | `████`                                                   |
| 20:00 | 13      | `██████`                                                 |
| 21:00 | 3       | `█`                                                      |
| 22:00 | 2       | `█`                                                      |
| 23:00 | 3       | `█`                                                      |
| 00:00 | 3       | `█`                                                      |

---

## What it corrects

### 1. The night is almost silent. My estimate was ~5x too high.

`plans/07` carried "~30 motion events per camera per night" as a conjecture. The measurement:
**82% of all events fall in 17:00–18:59** — dusk and daylight. From 21:00 to 00:12, the whole estate
produced **11 events in 3.2 hours**, about **3.4 per hour across all five cameras**.

Projected over a 9-hour night that is roughly **31 events for the estate**, not per camera. At the
asymmetric 24-frame window [T00](T00-frame-window-measurement.md) recommends, that is ~744 detection
calls spread across nine hours — **0.023 req/s** against a 1 req/s budget.

**The night backfill is effectively free.** The slow lane, the queue and the cron that `plans/07`
designed to protect the budget are solving a problem that does not exist at night.

### 2. Daylight is where the constraint lives.

The 18:00 hour alone produced 109 events. At 24 frames each that is 2 616 calls in an hour —
**0.73 req/s**, three quarters of the entire budget, competing with live captures.

So the pacing problem is real but inverted from how it was framed: it is a **daytime** problem, and it
argues for a cap on backfills per hour rather than a permanently throttled lane.

### 3. Most events are single pulses, not bursts. This one matters for the design.

| Channel | Bursts (events <30 s apart grouped) | Median size | Max | Singletons |
| ------- | ----------------------------------- | ----------- | --- | ---------- |
| ch3     | 40                                  | 1           | 10  | 24 / 40    |
| ch4     | 58                                  | 1           | 5   | 36 / 58    |
| ch8     | 11                                  | 1           | 3   | 10 / 11    |

**The median burst is one event.** The four-to-five pulse burst measured during the walk test — and
which the listener's debounce was designed around — is the exception, not the rule.

**Consequence for T02b.** `plans/07` proposed deriving the backfill window from the burst's first and
last pulse. On a singleton that yields a zero-width window, which is most of the time. The window has
to be a fixed asymmetric shape around a single pulse — [T00](T00-frame-window-measurement.md)'s
`[T − 10 s, T + 2 s]` — with the pulse train only widening it when a burst actually happens.

---

## The debounce, with a number behind it

Gaps between consecutive events on the same channel:

| Channel | n   | min | p50   | p90     | max     |
| ------- | --- | --- | ----- | ------- | ------- |
| ch3     | 77  | 1 s | 32 s  | 333 s   | 7 172 s |
| ch4     | 95  | 0 s | 58 s  | 594 s   | 4 312 s |
| ch8     | 12  | 4 s | 572 s | 6 863 s | 8 420 s |

- Gaps under 5 s: **53 of 184 (29%)** — what `DVR_EVENTS_DEBOUNCE_SECONDS=5` suppresses today.
- Under 10 s: 66 (36%).
- Under 30 s: 78 (42%).

The default of 5 s was a guess that matched the detection rung. It turns out to suppress about a
third of events while the median gap is half a minute, so it is doing real work without being
anywhere near aggressive enough to swallow distinct events. **Keep 5 s.** Raising it to 10 s would
suppress only 7% more.

---

## Two channels produced nothing, and the config is not why

ch5 and ch7 fired zero events in 6.7 hours. Their motion configuration is **identical** to the three
that did — `enabled: true`, `sensitivityLevel: 80`, the same full-frame `gridMap`,
`targetType: human,vehicle`, and all three linkages including `center`. ch7 also fired during the
walk test earlier the same evening, so the path works.

So this is real absence of classified motion, not the silent degradation that
[`docs/DVR_EVENTS_FOLLOWUP.md`](DVR_EVENTS_FOLLOWUP.md) warns about — and it is a useful negative:
the failure mode T05 exists to catch would have looked exactly like this, which is precisely why T05
cannot be an alert on "no events" alone. It needs to compare against a channel's own history.

**Open question, not answered here:** whether those two cameras genuinely saw nothing for seven hours,
or whether the recorder's classifier is missing what they see. Three weeks of recording are available
to check, and it is worth checking, because if it is the latter then event-driven capture is blind on
those cameras in a way no metric would reveal.

---

## What this changes in the plan

- **`DVR_EVENTS_DEBOUNCE_SECONDS=5` stays**, now with evidence rather than an analogy.
- **T02c's queue and slow lane are over-built for the night** and under-specified for dusk. Replace
  with a per-hour cap on backfills.
- **T02b cannot derive the window from the pulse train alone** — the median burst is one pulse. Fixed
  asymmetric window, widened by a burst when one occurs.
- **T00 sampling has a source now.** 187 timestamped events, and the log names the channel, so the
  remaining nine measurements can be drawn from it — including from ch3 and ch4, which T00 has not
  touched.

Raw log: 6.7 h, 2 723 records. Kept out of the repo (it is 600 KB of recorder chatter); the parsed
counts above are the artefact.
