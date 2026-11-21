# 003 — Extracting frames from recorded video: ffmpeg, and where it runs

**Status: proposed.** The owner picked the `mediamtx:<version>-ffmpeg` image on 2026-09-11; writing
this up found that the image does not reach the process that needs it. The options are below and the
recommendation is a host package.

## Context

[`plans/07`](../../plans/07.playback-backfill.md) T02 backfills a motion event by analysing frames
from the seconds around it instead of the single live frame taken after it. [T00](../T00-frame-window-measurement.md)
measured what that is worth: the single frame detects somebody in 2 of 10 events, twenty frames in
7 of 10. The window is `[T − 10 s, T + 0 s)` at 2 fps.

Getting those frames means decoding recorded video, and that is the whole problem.

### What the recorder will and will not give us

Verified against the DVR-208G-M1 on 2026-09-10 and recorded in [`BEST_PRACTICES.md`](../BEST_PRACTICES.md):

- `ContentMgmt/search` answers a `playbackURI` — an **RTSP stream** of H.264, never images, and
  always one continuous block because the recorder records continuously.
- **There is no playback-still endpoint.** `GET /ISAPI/Streaming/channels/<track>/picture?playbackTime=<ISO>`
  answers `200 image/jpeg` and silently ignores the parameter: asked for the previous night, it
  returned the live daylight frame, which only the clock burned into the image reveals. Three other
  shapes answer `404` or `403`.

So frames from the past require a decoder. There is no path around it.

### What MediaMTX does not solve

MediaMTX is already deployed as a sidecar for the live view ([`002`](002-hls-live-streaming.md)), so
it looks like the natural place for this. It is not:

- **It has no still-image endpoint.** The project's own documented way to extract snapshots
  (`docs/2-features/13-extract-snapshots.md`) is to run **ffmpeg** inside a `runOnAvailable` hook.
  Using MediaMTX to get frames means using MediaMTX to launch ffmpeg.
- **Its recording and playback server record what MediaMTX itself ingests, going forward.** The three
  weeks of history live on the recorder, not here.

### The constraint that decides this

**The API is not containerised.** There is no `Dockerfile`, `docker-compose.yml` declares exactly one
service (MediaMTX), and that file's own header calls it "a sidecar, not a dependency of the API
process". The API runs on the host under PM2.

Therefore an ffmpeg inside the MediaMTX container **cannot be spawned by the API**: `child_process`
does not reach another container's filesystem. `bluenviron/mediamtx:<version>-ffmpeg` puts ffmpeg
where MediaMTX can use it, which is only useful if MediaMTX is the one doing the extraction.

Also worth stating plainly, because the plan carried it as a blocker: **`002` did not reject ffmpeg
for this.** It rejected ffmpeg **transcoding** — "Only needed if a channel is not H.264. Costs CPU
per stream, so it stays unbuilt until a channel demands it." That is a per-viewer live cost. Offline
extraction of twenty frames from a bounded window, one event at a time, is a different workload and
`002` says nothing about it.

This would still be the **first `child_process` in the codebase**: `grep -rn child_process src/ scripts/`
returns nothing today.

## Decision

**Install ffmpeg on the host as a deploy prerequisite, and have the API spawn it directly.**

Alongside Node and PM2, which the host already needs. The deploy pipeline is not merged yet (PR #25,
`ci: T02 — deploy pipeline (SSH + PM2)`), so the prerequisite list is still being written and this is
the cheapest moment to add a line to it.

The extraction is one bounded command per event, the same one T00 used by hand:

```
ffmpeg -nostdin -rtsp_transport tcp \
  -i "rtsp://<user>:<pass>@<dvr>:554/Streaming/tracks/<ch>01/?starttime=…&endtime=…" \
  -vf fps=2 -frames:v 20 -q:v 3 <dir>/f_%03d.jpg
```

`-nostdin` is not decoration: without it ffmpeg consumes the parent's stdin, which silently ate a
measurement run's event list during T00.

**The recorder password is in that URL**, so the command must be spawned with an argument array and
never through a shell, and the URL must never reach a log line. `AGENTS.md` already requires that the
plaintext behind `Dvr.passwordEncrypted` not leave the process; a spawn argv keeps it out of the
process table's command string only if the array form is used.

## Alternatives rejected

- **ffmpeg inside the MediaMTX container, driven by its hooks.** The owner's first choice, and it
  does work in principle: register a path pointing at the recorder's `playbackURI`, let
  `runOnAvailable` write JPEGs to a bind-mounted volume, have the API read the directory. Rejected
  because it puts batch work inside the live-video server for no gain. `docker/mediamtx.yml` documents
  its own `authHTTPExclude` as "load-bearing, not tidiness" — empty that list and no path is created
  and live view silently stops — and every new path would be consulted against the authorization hook
  too. The hooks are built for live paths, not one-shot jobs, and failure reporting degrades to "the
  files never appeared". It buys nothing over a host package except avoiding one `apt install`.
- **`docker exec` into the MediaMTX container.** Requires giving the API process access to the Docker
  socket, which is host root. An enormous privilege surface for a frame extractor.
- **A throwaway `docker run` per backfill.** Same Docker socket problem.
- **Containerising the API so it can carry its own ffmpeg.** The right long-term shape, and far too
  large a change to make as a side effect of a backfill feature.
- **A Node H.264 decoder, no subprocess.** Avoids the spawn entirely, but means an unfamiliar decoding
  dependency doing the job a mature, already-installed tool does in one line.

## Consequences

- **A prerequisite the deploy must check.** A host without ffmpeg fails at the first backfill, at
  runtime, on a code path nobody watches. Whatever starts the backfill should verify the binary once
  at boot and refuse loudly rather than per event.
- **The backfill is off by default**, like the ledger, so a host missing the binary is inert rather
  than broken.
- **Frames are written to disk, briefly.** They are images of a private home with identifiable people
  in them. A temporary directory removed after the batch, never inside the repo, never served.
- **`bluenviron/mediamtx:1.20.1-ffmpeg` is not needed** by this decision. Nothing transcodes today —
  `002` chose repackaging precisely to avoid it. The tag is the right change on the day a channel
  turns out not to be H.264, and not before.

## What would reverse this

- The API gets containerised for other reasons. Then ffmpeg belongs in its image and this becomes a
  packaging line rather than a host prerequisite.
- The host turns out to be one nobody may install packages on. Then the MediaMTX hook path is the
  fallback, with its costs accepted explicitly.
- face-auth ships something that takes video rather than images, which would remove the extraction
  step rather than relocate it.
