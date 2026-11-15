import type { SceneItem } from '../types/studio.ts';
import { DIRECTOR_PRESETS, ENTRANCES, LAYOUTS, MOTION_TRANSITIONS } from './types.ts';
import { ALL_ACTIVE_SFX_CUES } from '../utils/sfxSchedule.ts';
export function validateMotionScenes(scenes: SceneItem[]): void {
  for (const [i, scene] of scenes.entries()) {
    const m = scene.motion;
    if (!m) continue;
    if (
      m.version !== 1 ||
      !DIRECTOR_PRESETS.some((p) => p.id === m.preset) ||
      !LAYOUTS.includes(m.layout) ||
      !ENTRANCES.includes(m.entrance) ||
      !MOTION_TRANSITIONS.includes(m.transition) ||
      !Number.isFinite(m.transitionMs) ||
      m.transitionMs < 0 ||
      m.transitionMs > 600 ||
      typeof m.headline !== 'string' ||
      m.headline.length > 240 ||
      (m.originMs !== undefined && (!Number.isFinite(m.originMs) || m.originMs < 0)) ||
      (m.secondaryText !== undefined &&
        (typeof m.secondaryText !== 'string' || m.secondaryText.length > 240)) ||
      (m.secondaryAtMs !== undefined && !Number.isFinite(m.secondaryAtMs)) ||
      typeof m.accent !== 'string' ||
      m.accent.length > 120 ||
      !Array.isArray(m.cues) ||
      m.cues.length > 4 ||
      m.cues.some(
        (c) =>
          !Number.isFinite(c.atMs) ||
          c.atMs < scene.startMs - 600 ||
          c.atMs > scene.endMs ||
          (c.cue !== 'none' && !ALL_ACTIVE_SFX_CUES.includes(c.cue))
      )
    )
      throw new Error(`Invalid motion plan for shot ${i + 1}. Regenerate direction before export.`);
    if (
      scene.words?.some(
        (w, j) =>
          typeof w.text !== 'string' ||
          !Number.isFinite(w.startMs) ||
          !Number.isFinite(w.endMs) ||
          w.endMs < w.startMs ||
          (j > 0 && w.startMs < scene.words![j - 1].startMs)
      )
    )
      throw new Error(`Invalid word timestamps for shot ${i + 1}.`);
  }
}
