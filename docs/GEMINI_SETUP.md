# Connect Gemini safely to SceneSync (Windows, Google AI Studio and GitHub)

SceneSync uses Gemini to **see uploaded pictures** and match them to the voiceover script.
You do **not** need to rename or manually number 110 photos.

## Security: rotate the exposed key first

If your Gemini API key appeared in a screenshot, revoke/delete that key in [Google AI Studio](https://aistudio.google.com/api-keys) and create a new one. Do not put the new key in a screenshot, chat, GitHub issue, commit, pull request, or `.env.example`.

## Running SceneSync on your own Windows PC

1. Download the latest feature branch (or merge the reviewed pull request).
2. In the extracted project folder, open `.env` with Notepad. If `.env` does not exist, copy `.env.example` and rename the copy to `.env`.
3. Set `GEMINI_API_KEY` to your **newly rotated** private key, using the format:
   ```ini
   GEMINI_API_KEY=PASTE_YOUR_NEW_PRIVATE_KEY_HERE
   GEMINI_VISION_MODEL=gemini-3.5-flash-lite
   GEMINI_BLUEPRINT_MODEL=gemini-3.8-flash
   ```
4. Save the file, close the old SceneSync terminal, and restart `launch-studio.bat`.
5. Refresh `http://localhost:3000`. In **Assemble Video**, select **Auto Vision (Gemini key found)** and click **Test Gemini**.
6. Only after the test succeeds, upload your voiceover, exact script, and your pictures in one batch. SceneSync uses Gemini Vision to inspect **all** images. Manual numbering is not required.

**The key is read on the server.** The UI's connection test sends no key in the browser request and never returns the key. `.gitignore` already excludes `.env*` except the fake-key template `.env.example`.

## If you use Google AI Studio

Configure the key in AI Studio's secrets/environment for the deployed app; that environment is separate from the Windows download. Keep the actual key private. If the app is hosted elsewhere, use that hosting provider's secret manager.

## What about GitHub secrets?

GitHub repository **Settings → Secrets and variables → Actions → New repository secret** can store `GEMINI_API_KEY` for a GitHub Actions workflow *that explicitly references it*. **Adding it there does not automatically configure your local Windows app**, and it does not automatically configure Google AI Studio or another hosting service. Do not place the real key in Git-tracked files.

## Checks, model access and costs

- `GEMINI_VISION_MODEL` defaults to `gemini-3.5-flash-lite` and analyzes the actual uploaded images in batches. The server caches visual descriptions.
- `GEMINI_BLUEPRINT_MODEL` defaults to `gemini-3.8-flash` to create topical story outlines instead of using an outdated hard-coded model name.
- **Test Gemini** makes one small, explicitly user-triggered API request to validate access. The dropdown's `key found` label means only that a key exists; it is **not** proof that authentication works.
- API usage may be billable, subject to account quotas. Review your Google AI Studio project limits.
- Photo selection is automated, but word-accurate spoken timing and guaranteed story continuity still require further development.

If the connection test fails, it reports a general category (invalid/revoked key, unavailable model or quota/network issue) without exposing the key.
