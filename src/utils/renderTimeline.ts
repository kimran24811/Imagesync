import type { SceneItem } from '../types/studio.ts';

export const RENDER_FPS = 30;

/** Quantize absolute boundaries, never round/pad durations independently. */
export function planRenderTimeline(scenes: SceneItem[], durationMs: number): {
  frameCounts: number[];
  totalFrames: number;
} {
  if (!Number.isFinite(durationMs) || durationMs <= 0 || !scenes.length) {
    throw new Error('Export requires a readable voiceover and at least one shot.');
  }
  const totalFrames = Math.ceil(durationMs * RENDER_FPS / 1000);
  let previousMs = 0;
  let previousFrame = 0;
  const frameCounts = scenes.map((scene, i) => {
    if (!Number.isFinite(scene.startMs) || !Number.isFinite(scene.endMs) ||
        Math.abs(scene.startMs - previousMs) > 1 || scene.endMs <= scene.startMs ||
        scene.endMs > durationMs + 1) {
      throw new Error(`Invalid timeline at shot ${i + 1}: shots must be ordered, contiguous and inside the voiceover.`);
    }
    const endFrame = i === scenes.length - 1
      ? totalFrames : Math.round(scene.endMs * RENDER_FPS / 1000);
    const frames = endFrame - previousFrame;
    if (frames < 1) throw new Error(`Shot ${i + 1} is shorter than one video frame (33.3 ms).`);
    previousFrame = endFrame;
    previousMs = scene.endMs;
    return frames;
  });
  if (Math.abs(previousMs - durationMs) > 1) {
    throw new Error('The shot timeline must cover the complete voiceover. Recalculate timings before export.');
  }
  return { frameCounts, totalFrames };
}
