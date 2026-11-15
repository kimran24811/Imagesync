# Milestone 1: reliable rendering and synchronization

## Source and architecture audit

Base: `feature/director-cut-engine-v1` at `5bdc94548c03f494dd3ed7e6a582a2900765b15a`.
React owns intake, storyboard edits, approximate CSS preview and export monitoring.
Express (`server/routes/studio.ts`) owns multipart/chunk uploads, in-memory projects,
analysis, jobs, SSE and disk export recovery. Media processing uses FFprobe/FFmpeg.
Gemini/Ollama caption all thumbnails and cache descriptions; semantic matching and
pause/word-count timing produce scenes. Graphic cards use resvg PNG rasterization.
ASS captions and procedural SFX share frontend timing utilities. The renderer creates
1080p segments, then composes transitions, captions and mixed audio.

### Root causes found in source

- `videoRenderer.ts` independently forces every scene to >=8 frames, ignores gaps,
  overlaps and the narration's real stream duration, and permits a 750ms shortfall.
- Its master graph decodes every 1080p segment simultaneously. A 50–110-shot xfade
  chain has unbounded memory/input pressure. `tpad` hides broken segments with holds.
  Recovery silently changes requested transitions into hard cuts.
- Only video duration is validated; missing/short audio, wrong dimensions, bad
  frames, timestamps or truncated output can pass. Partial files use final names.
- `studio.ts` recovers any matching MP4 as completed, even failed partial renders;
  completion is emitted before the route receives the downloadable file path.
- Audio analysis prefers container duration over the audio stream (wrong for uploads
  containing longer video streams).
- `sceneAligner.ts` Auto Vision calls `alignWithVisualCaptions`, which estimates
  speech positions from text length/emotional weight and pauses. The older Gemini
  multimodal acoustic routine is unreachable. Neither path supplies word timestamps.
  Caption reveal evenly divides text inside a beat, so render integrity alone cannot
  establish that captions correspond to actual spoken words.
- Browser preview uses independent CSS crop/zoom/card/flash effects and approximate
  music ducking. CSS animation does not seek with the audio; B-roll also starts at
  zero on scene changes/seeks. A flash plays at every dynamic cut, unlike the planner.
- Existing CI permits FFmpeg tests to skip on Linux. Windows only checks card file
  size, not decoded frames, full-reel timing, audio or failure recovery.
- Vision availability is configuration/tag presence, not proof of image capability.
  Model names/API access need live verification in milestone 2; no credentials or
  local vision server are available in this environment.

## Concrete implementation plan

1. `src/utils/renderTimeline.ts`: validate contiguous scenes; quantize absolute
   boundaries to 30fps, preserving all planned shots and the final narration frame.
2. `server/services/renderValidation.ts`, `audioAnalyzer.ts`: probe audio stream
   duration; validate actual frame counts, codecs, dimensions, start times, video
   and audio duration, and fully decode the final MP4 before accepting it.
3. `server/services/videoRenderer.ts`: validate each segment, bounded two-input
   transition composition, concatenate normalized beats, retain caption/music/SFX
   mastering and CPU fallback, publish only validated output by atomic rename.
   Keep partial MP4s in the temporary render directory and clean on all exits.
4. `server/routes/studio.ts`: publish download paths before completed events;
   atomic metadata; recover only recorded successful outputs; mark interrupted jobs
   failed instead of inferring success from an arbitrary MP4 filename.
5. `src/components/SyncPreviewPlayer.tsx`, `IntakeWorkspace.tsx`, `ExportModal.tsx`, caption utilities: seek B-roll/CSS motion
   with narration; share transition planning and fix caption intervals past scene
   end. Identify the live preview as approximate; final MP4 remains authoritative.
6. `tests/*`, `tests/integration/*`, `tests/fixtures/*`, `package.json`, lockfile,
   `.github/workflows/director-cut-ci.yml`: unit regressions, mandatory real render
   suite, known speech/color fixtures, decoded output/timing/audio assertions,
   failure/cleanup tests, Linux and Windows CI, one-minute 50-asset stress case.

## Scope boundary

This milestone guarantees integrity of a supplied timeline, not speech recognition
or semantic correctness of AI assignments. True forced alignment, live model
capability checks and real narration match evaluation are milestone 2. Existing art
styles, animation, captions, music and SFX remain available. No merge to main.

## Validation results

Environment: Linux, Node 24.22.1, FFmpeg/FFprobe 7.1.5, CPU libx264.
Starting-branch baseline: TypeScript, production build and all 24 existing tests
passed; a five-second synthetic export completed. The audit therefore added
checks beyond the prior green tests.

Validation commands and observed results:

- `npm ci --no-audit --no-fund`: reproducible dependencies from new npm lockfile.
  npm is the existing CI/Windows-launcher package manager; use package-lock.json.
- `npm run lint`: passed (server, client and tests).
- `npm test`: 31 unit/card/command-process tests passed; actual PNG statement/counter encoding included.
- `npm run test:render`: all nine mandatory real FFmpeg/HTTP regressions passed, no model/key
  needed. Verifies decoded shot pixels and transitions, visible captions, photo
  movement, looping B-roll movement, speech/audio correlation at beginning/middle/
  end, SFX and ducked music, actual video/audio durations, AMF-unavailable CPU
  recovery, missing media, invalid timings, cleanup, immediate download and job
  recovery after a real server-process restart. Tiny shots and single-shot
  landscape exports are covered as well.
- `npm run test:render:long`: 60 seconds, 110 arbitrarily named assets in reversed
  map insertion order, 50 explicitly assigned shots, 1080×1920, 1,800 decoded
  frames, captions, selected whips, hard cuts and SFX; checks all 50 shot centers.
  This is a deterministic rendering stress fixture, not an AI matching benchmark.
- `npm run build`, `git diff --check`: passed. Vite reports an existing future
  config-loader deprecation warning for `__dirname` in vite.config.ts.
- Headless Chromium smoke check on the built app, with an HTTP-created synthetic
  image/B-roll session: scrubbing seeks paused image animation, scene-local video
  time and narration time; no page errors. CSS effects and sound mixing remain
  approximate, and the export dialog now offers the final MP4 immediately.

Regressions caught while adding these tests included FFmpeg dropping frame-rate
metadata after trimming and stream-copy concat reporting only 0.167s for seven
frames that should span 0.233s. Master timestamps are now regenerated from decoded
frame index. The uneven-clause allocator also reproduced a zero-duration final
shot in a two-shot 200ms timeline; minimum reservation fixes that overshoot.

### Contract and tradeoffs

- A supplied scene timeline must be contiguous and cover the probed audio duration.
  Malformed edits fail explicitly rather than silently stretching/reordering shots.
- Shots use rounded absolute 30fps boundaries; the final boundary uses ceiling so
  video covers the final audio sample. Difference is <33.34ms; AAC coverage permits
  one 1024-sample packet (about 21.34ms) plus rounding. This is not millisecond-
  accurate speech alignment.
- Each source and composed beat is decoded/count-checked. Transitions use two video
  inputs at a time, then a concat demuxer feeds final caption/audio mastering.
  Snap cuts have zero overlap. Requested accents are retained; composition errors
  fail the job rather than silently replacing transitions with cuts.
- Bounded composition and final timestamp normalization add encoding work and
  temporary disk usage. CPU encoding is capped at four threads. Disk-space guards,
  cancellation, crash-orphan cleanup and an ordered job queue are follow-up work.
- Only a validated MP4 receives its final filename. The server persists its output
  path before broadcasting completion. Metadata writes use same-directory atomic
  replacement; missing outputs and interrupted jobs recover as failures. Exports
  without metadata are no longer inferred successful from filenames; existing
  files are left untouched. Projects themselves still live in memory.
- Windows-friendly relative generated filenames avoid filter/concat escaping of
  drive letters, apostrophes, commas and Unicode directories. Tests exercise these
  paths on Linux; native Windows execution remains a required separate check.

### Windows PC acceptance checks

Run `npm ci`, `npm run lint`, `npm test`, `npm run test:render`,
`npm run test:render:long` and `npm run build` with your FFmpeg **9.0.2 essentials**
and FFprobe on PATH. CI uses Windows/Node 22 and requires that exact FFmpeg version;
it cannot validate your AMD GPU/driver. Verify successful **AMF** encoding on the
PC, then CPU fallback when hardware is unavailable; inspect final MP4 playback in
VLC and on a phone, fonts (including any Urdu/Arabic script), first/middle/final
shots, voiceover tails, transition variety and audible ducking/SFX balance. Repeat
with your real one-minute narration and 50–110 unnumbered assets. Automatic semantic
matching and word timing still require milestone 2 evaluation, so the complete
product success criterion is not yet claimed.

## Recommended next sequence

1. **Speech alignment and visual matching:** make exact script-to-speech alignment
   independent of the selected vision provider; store word timestamps and confidence,
   use them for captions/shot boundaries, validate live Gemini model access and
   Ollama image capability, and evaluate chronology/relevance on labeled examples.
2. **Single-user persistence foundation:** atomic project manifests or SQLite after
   evaluating migration needs; recover uploads/edits, queue/cancel renders, enforce
   disk-space checks and clean abandoned temporary data. Do this before expanding
   creative work that would otherwise be lost on restart.
3. **Director engine:** constrained effect/pacing selection, four named presets,
   richer transitions/SFX/music mastering, and shared preview/export motion models.
4. **Faceless Motion Explainer:** character/pose/reference library, transparent PNG
   assets, palette/background locks, concept overlays and pose/icon scheduling.
   Preserve and regression-test all existing art styles.
