# Director Cuts v1

Director Cuts is the upgraded option in the **Transitions** section of SceneSync Studio. It uses the existing `whip-dynamic` setting, so old sessions still load without migration.

## Director's quick workflow

1. Upload voiceover and an accurate script. Add unordered images or B-roll; Auto Vision inspects their contents without filename requirements.
2. Select **Rapid Reel** pacing; use **Director Cuts · Snap + Whip**.
3. Keep transitions and the SFX engine enabled. Prefer clear dialogue and edit SFX volume down if the result sounds crowded.
4. Review the storyboard: alternate medium/wide/close focal beats, add graphic cards only for genuine facts, and manually tune misplaced images.
5. Preview, export 9:16, watch the MP4 on a phone with headphones, and correct any weak opening seconds.

## What this version changes

- Selects mostly quick cuts with selective 3–4-frame whips / flash accents for stronger visual rhythm.
- Plans overlaps from actual neighboring segment frame counts instead of one long transition duration.
- Adds a hook impact layer when enabled and applies SFX lane cooldowns / layer caps.
- Sweeps SFX events between preview animation frames so slow devices drop fewer cues.
- Applies an audio peak limiter after mixing.
- Cleans render temporary segment files even when FFmpeg throws.
- Clamps excessively high automatic beat counts in short audio.

## What it does **not** promise

- It does not guarantee virality, fully understand arbitrary image content offline, or match the FFmpeg render and browser preview pixel-for-pixel.
- It does not provide word-level speech timing, automatic local image creation, project recovery or resuming interrupted renders after server restart, disk quotas, or upload resumability. These are future work.
- FFmpeg 4.4.2 and Windows should be checked on the target machine, particularly filter support and available fonts.

## Verification

Run `npm run lint`, `npm test`, and `npm run build`. GitHub Actions also runs mandatory real FFmpeg render regressions and a one-minute stress render on Linux and Windows. See [Milestone 1](./MILESTONE_1.md) for commands, acceptance criteria and remaining speech-alignment limitations. For render QA, compare frame counts, soundtrack length, caption timing and final loudness with a short real sample.
