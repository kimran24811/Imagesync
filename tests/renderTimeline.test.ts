import assert from 'node:assert/strict';
import test from 'node:test';
import type { SceneItem } from '../src/types/studio.ts';
import { planRenderTimeline } from '../src/utils/renderTimeline.ts';
import { buildDynamicCaptionFrames, getActiveDynamicFrame } from '../src/utils/captions.ts';

const scene = (startMs: number, endMs: number) => ({ id: String(startMs), index: 0,
  startMs, endMs, durationMs: endMs - startMs, text: 'one two three four five six seven eight nine ten',
} as SceneItem);

test('absolute frame boundaries preserve micro-shots and cover the last audio sample', () => {
  const plan = planRenderTimeline([scene(0, 100), scene(100, 250), scene(250, 1001)], 1001);
  assert.deepEqual(plan.frameCounts, [3, 5, 23]);
  assert.equal(plan.totalFrames, 31);
  assert.equal(plan.frameCounts.reduce((a, b) => a + b), 31);
});

test('rejects empty, nonfinite, overlapping, missing and too-short shots', () => {
  for (const [scenes, duration] of [
    [[], 1000], [[scene(0, NaN)], 1000], [[scene(0, 500), scene(400, 1000)], 1000],
    [[scene(0, 400), scene(500, 1000)], 1000], [[scene(0, 900)], 1000],
    [[scene(0, 1), scene(1, 1000)], 1000], [[scene(0, 1000)], Infinity],
  ] as Array<[SceneItem[], number]>) assert.throws(() => planRenderTimeline(scenes, duration));
});

test('captions never escape short scene bounds or appear outside their interval', () => {
  const shot = scene(100, 200);
  shot.durationMs = 999; // stale UI duration must not move caption timing
  const frames = buildDynamicCaptionFrames(shot, 'word-pop', 'type-reveal', '9:16');
  assert.ok(frames.length > 0);
  assert.ok(frames.every(f => f.startMs >= 100 && f.endMs <= 200 && f.endMs > f.startMs));
  assert.equal(getActiveDynamicFrame(shot, 99, 'word-pop', 'type-reveal', '9:16'), null);
  assert.equal(getActiveDynamicFrame(shot, 200, 'word-pop', 'type-reveal', '9:16'), null);
});
