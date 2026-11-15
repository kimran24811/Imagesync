# Automatic Reel Director

The intended workflow is voiceover + exact script + unordered images/clips →
Generate Reel → completed MP4. This branch extends the tested Milestone 1 pipeline;
it does not replace the existing styles, blueprint generator or manual editor.

## Morning quick start (Windows)

1. Check out `codex/automatic-motion-director`, install Node 22+, FFmpeg 9.0.2 and
   FFprobe, and run `npm ci`. Start with `launch-studio.bat` or `npm run dev`.
2. For automatic image understanding, configure Gemini privately in `.env`, or run
   an Ollama vision model locally. Filenames need no numbering. Ollama now checks
   the model's advertised vision capability; tag presence alone is insufficient.
3. For recognized speech timing, install Python 3.10–3.12, then click **Set up
   speech**. Alternatively run `npm run setup:speech`. The multilingual base model
   downloads once to `workspace_data/_speech`; transcription runs locally on CPU
   with int8, including on AMD PCs without CUDA. `SPEECH_MODEL`, `SPEECH_PYTHON`,
   `SPEECH_CACHE_DIR` and `SPEECH_LANGUAGE` are optional overrides.
4. Upload the narration, paste the exact script, and add the images. Choose one of
   the five director presets, then click **Generate Reel**. Automatic export is on
   by default. The advanced format/caption/editor controls remain available.
5. The finished export can be played/downloaded immediately. Projects autosave and
   can be resumed after restart. Rendering is queued serially and can be cancelled.

Click **Try Narrated Motion Demo** to see the new system before configuring any
provider: it uses bundled synthetic narration, curated existing images and real,
precomputed speech timestamps. With Director disabled, the original cadence-only
Sample Story remains available and explicitly uses estimated timing. No image-generation service is required for the new motion system.

## What was implemented

- **Five presets:** Editorial Motion (reference-inspired pink/cream editorial
  graphics), Rapid Viral, Cinematic Storytelling, Educational Explainer and
  High-Energy Cartoon. Art style remains separate from directing style.
- **Shared, layered SVG composition:** headlines, animated counters, chapter/list
  panels, outlined callouts, icons, accent lines, progress shapes and spoken-word
  caption plates. Rise, pop, slide, wipe, blur, typewriter and tracking entrances
  have deterministic easing. Hook headlines can persist across an image cut while
  a second phrase reveals at its narration timestamp.
- **27 transition choices, including cut:** validated FFmpeg crossfades, wipes,
  slides, smooth moves, circles, radial, pixelize, blur, zoom, squeeze and diagonal
  reveals. The director uses a constrained subset per preset; all choices are
  accessible under a shot's optional Director plan overrides. Quiet shots and
  transition overlap limits remain enforced.
- **Sound from animation events:** entrance, emphasis and numeric reveal cues use
  the same absolute timestamps in preview and export. Directed sound design has
  cooldowns and a three-cue-per-second cap. Existing 12 procedural cues remain;
  `SFX_LIBRARY_DIR` can supply recorded `impact.wav`, `whoosh.wav`, `pop.wav`, etc.
- **Automatic original instrumental bed:** local chord/pulse synthesis when no
  music is uploaded, with voice ducking and limiting. User-supplied music takes
  precedence; the automatic bed can be disabled. This is procedural underscore,
  not a generative-music API or a claim of custom professional composition.
- **Local word timestamps:** faster-whisper transcription is aligned monotonically
  to the exact supplied script. Original script words are preserved. Unmatched
  words are inferred between speech anchors and identified as inferred. Automatic
  mode reports estimated timing when speech is not installed; Required mode fails
  unless at least 90% of script words match. Very different scripts fail with an
  actionable diagnostic instead of fabricated word locks.
- **Image matching:** all thumbnails still receive visual descriptions and cache
  entries. A narrative matching pass can reason over those descriptions using
  Gemini or Ollama. Invalid/missing IDs are rejected. If that reasoning request
  fails, local description similarity is disclosed, with confidence warnings.
- **Optional Gemini direction suggestions:** headlines and accent phrases must be
  exact substrings of the script, and layouts/entrances must exist in the library.
  Invalid suggestions use local rules. The UI identifies rules vs AI assistance;
  a cloud model is never required to execute the animations.
- **Persistence and recovery:** serialized per-project JSON autosaves, assets/maps,
  motion plans, speech words, settings and music survive a restart. Interrupted
  renders stay failed/cancelled; completed downloads retain Milestone 1 validation.
- **Upload integrity:** chunks are size-limited, ordered and hashed; retries do not
  append bytes twice; incomplete uploads cannot start analysis. Up to 150 visuals
  plus voiceover and music are accepted. Upload sessions themselves do not resume
  after a server restart yet.
- **JPEG compatibility:** the browser test with real JPEG artwork exposed inherited
  full-range color metadata. Photo/video scaling now explicitly converts to TV
  range before strict H.264/yuv420p validation; the validator was not relaxed.

## Architecture and file map

- `src/director/types.ts`: versioned motion plans, settings, presets and catalog.
- `src/director/planner.ts`: local directing grammar, speech attachment, pacing
  contrast, hook continuity and sound-event timing. No filename-based vision.
- `src/director/composition.ts`: pure timestamp → SVG evaluator. No DOM or provider
  dependency; all user text is XML escaped. Preview inserts only this trusted SVG.
- `src/director/validation.ts`: effect allowlists and finite timing checks before
  FFmpeg, including for API-supplied plans.
- `server/services/motionRenderer.ts`: bounded PNG streaming into FFmpeg's overlay
  compositor; backpressure, cancellation, diagnostic capture, no frame-directory
  explosion. The same bundled DejaVu fonts are used by preview/export.
- `server/services/directorEngine.ts`, `narrativeMatcher.ts`: optional cloud/local
  reasoning with validation and explicit fallback provenance.
- `server/services/speechAligner.ts`, `server/scripts/transcribe.py`,
  `scripts/setup-speech.mjs`: optional local speech runtime, caching and script/
  transcript alignment. Python requirements are pinned; unbounded PyAV upgrades
  broke `metadata_errors` in real testing and are deliberately prevented.
- `server/services/musicBed.ts`, `src/utils/sfxSchedule.ts`: original underscore
  and shared sound scheduling. Existing FFmpeg ducking/limiting is retained.
- `projectStore.ts`, `renderQueue.ts`, `server/routes/studio.ts`: atomic project
  manifests, single-compositor queue, cancellation, disk-space checks, uploads and
  the directing/project/setup endpoints.
- `DirectorControls.tsx`, `App.tsx`, `SyncPreviewPlayer.tsx`, `StoryboardTimeline.tsx`:
  one-click generation, preset changes, saved projects, shared overlay preview and
  optional per-shot overrides. Legacy controls remain available when Director is off.

SVG was chosen for this first layered compositor because resvg was already shipped
and verified on Windows. It avoids a new Chromium installation/runtime for export,
keeps Node/FFmpeg and AMF encoding, and permits identical overlay composition code
in the browser. The editor is extensible, but this is not full CapCut feature parity:
there is no general keyframe editor, 3D character rig, roto engine or arbitrary
third-party effect importer. A future WebGL/Remotion renderer can consume versioned
plans without replacing upload, alignment, project storage or audio mastering.

## Tests and practical limits

Run `npm run lint`, `npm test`, `npm run test:render`, `npm run test:render:long`,
`npm run build`, and—after speech setup—`npm run test:speech`.

Real render checks cover all five presets, the entire transition catalog, JPEG
color conversion, visible overlays, source-image visibility, exact frame/audio
coverage, music/SFX, cancellation/cleanup, chunk retries, HTTP generation and
restart recovery. The stress suite includes a fully directed 60-second, 50-shot
reel selected from 110 unordered assets. Speech tests use a real downloaded model,
not a mocked word list. Provider contract tests use a local fixture server; actual
Gemini/Ollama inference requires the user's configured service and is not certified
by those tests. Windows CI runs the render suites and real speech tests separately.

Overlay layouts/animations are shared; photo camera motion, transition previews
and live music ducking still use the existing browser approximations. The final
MP4 is authoritative. Initial renders are slower because each layered frame is
rasterized; PNG frames are piped rather than accumulated on disk. Existing output
validation still fully decodes the final video before publication.

Word timestamps are transcription-derived, not manually verified phoneme alignment.
Unmatched spelling/number forms and transliterated scripts can need review. Bundled
fonts cover common Latin/Greek/Cyrillic/Hebrew/Arabic ranges; other writing systems
need an appropriate font. Clean stills cannot independently animate a flattened
character's limbs; separate cutouts or video are needed for that kind of movement.

Successful AMD AMF encoding, the owner's real image/narration relevance, perceived
sound balance and aesthetic quality still need acceptance on the Windows PC. The
system provides automatic motion design with explicit provenance; it does not
claim to reproduce every editor feature or guarantee a human expert's taste on
arbitrary material. Remaining work includes crash-orphan cleanup, resumable upload
sessions, richer asset libraries, subject-aware text placement, deeper preview
parity, and additional authored design recipes.
