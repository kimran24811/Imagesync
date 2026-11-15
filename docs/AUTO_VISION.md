# SceneSync Auto Vision: zero manual image numbering

SceneSync can inspect **every image** and choose visuals for spoken script beats. Filenames do **not** need numbers or descriptions. You may upload 110 unordered Veo stills. In Rapid Reel mode a 60-second narration typically creates about 55 selected cuts, not 110 forced cuts.

## One-time setup for free local image understanding (Windows)

1. Install Ollama from https://ollama.com and run it locally.
2. Open Command Prompt and run:
   ```bat
   ollama pull gemma3:4b
   ```
   This downloads a local vision-capable model once. It requires disk space and may be slow on CPU-only systems.
3. Restart the SceneSync launcher (and reload the browser tab).
4. In **Assemble Video → Sync**, choose **Auto Vision (Local AI ready)**, or specifically **Local AI Vision (Ollama)**.
5. Upload your real voiceover, its *exact* script, and all your images in a batch. No renaming is necessary.
6. Click **Analyze & Build Timeline**, then inspect the scene match explanations and low-confidence warnings. Export after reviewing.

Alternatively, [configure a **new private Gemini API key**](./GEMINI_SETUP.md) in your local `.env` and choose Gemini Vision. Never place the key in a GitHub commit. Gemini may incur API charges. Its captioning path processes all images in batches, rather than only the first 36. The preferred default model is `gemini-3.5-flash-lite`.

## What the visual matcher does

- Uses the uploaded thumbnail pixels to produce literal descriptions of subjects, actions, expressions, environment and camera angles.
- Caches descriptions by image content hash to avoid paying inference costs repeatedly.
- Breaks the provided script into beat clauses, selects the most relevant image captions, avoids unnecessary repeats, and reports a confidence indicator.
- Uses voiceover duration and detected pauses for estimated shot boundaries.
- Preserves the existing scene swap/reorder UI for optional corrections.

## Important limitations

- Audio sync is **not word-accurate speech transcription**. Word-level alignment is separate future work. The uploaded script should exactly match the spoken audio.
- Visual descriptions from small models can be imperfect. High-relevance edits may still need review for chronology or gestures.
- Uploading 110 images does not mean the video must display all 110. Auto Rapid Reel selects a subset to fit the narration. Explicit **1-to-1 Uploads** forces a beat per uploaded image and may be too fast.
- If neither local Ollama nor Gemini is available, automatic matching **stops with an actionable error**; it does not silently pretend filenames are image recognition. The optional **Manual file order** mode does not inspect images.
- Ollama works only if the backend can reach the configured local vision model. On a hosted/cloud backend, you need a reachable vision service or Gemini key.
