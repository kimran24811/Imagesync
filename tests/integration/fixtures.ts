import fs from 'node:fs/promises';
import path from 'node:path';
import type { SceneItem } from '../../src/types/studio.ts';
import type { RenderProjectInput } from '../../server/services/videoRenderer.ts';
import { rasterizeGraphicCardSvg } from '../../server/services/cardRenderer.ts';
import { runCommand } from '../../server/services/execUtils.ts';
import { DEFAULT_SFX_CONFIG } from '../../src/utils/sfxSchedule.ts';

export const COLORS = ['#e02020', '#20c020', '#2020e0', '#e0c020', '#c020c0'];

export async function fixture(dir: string, count = 5, durationMs = 5000): Promise<RenderProjectInput> {
  await fs.mkdir(dir, { recursive: true });
  const audioPath = path.join(dir, 'voice.wav');
  await runCommand('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i',
    `sine=frequency=440:sample_rate=48000:duration=${durationMs / 1000}`, audioPath]);
  const mediaById: RenderProjectInput['mediaById'] = new Map();
  const scenes: SceneItem[] = [];
  for (let i = 0; i < count; i++) {
    // Arbitrary names and scrambled insertion order must never determine shot order.
    const id = `asset_${(i * 37 + 13) % 997}`;
    const file = path.join(dir, `${id}.png`);
    await rasterizeGraphicCardSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="108" height="192"><rect width="108" height="192" fill="${COLORS[i % COLORS.length]}"/></svg>`, file);
    mediaById.set(id, { path: file, mediaType: 'image' });
    const startMs = Math.round(i * durationMs / count);
    const endMs = Math.round((i + 1) * durationMs / count);
    scenes.push({ id: `scene_${i}`, index: i, text: `Color number ${i + 1}`,
      startMs, endMs, durationMs: endMs - startMs, imageId: id, matchReason: 'Known fixture',
      emotionalWeight: 1, kenBurnsDirection: 'zoom-in', snappedToPause: false,
      alignmentSource: 'estimated', beatKind: 'media', sfxCue: 'pop' });
  }
  return { jobId: 'integration', projectId: 'fixture', projectDir: dir,
    sfxDir: path.join(dir, 'sfx'), audioPath, audioDurationMs: durationMs,
    aspectRatio: '9:16', motionIntensity: 'none', transitionStyle: 'whip-dynamic',
    transitionDurationMs: 280, subtitlesEnabled: true, captionMode: 'word-pop',
    textEffect: 'kinetic-karaoke', fontStyle: 'modern-sans', accentColor: 'gold',
    brandKicker: '', sfxConfig: { ...DEFAULT_SFX_CONFIG }, encoderId: 'libx264',
    scenes, mediaById: new Map([...mediaById.entries()].reverse()), onProgress: () => {} };
}
