import assert from 'node:assert/strict';
import test from 'node:test';
import { computeTargetBeatCount } from '../server/services/sceneAligner.ts';

test('automatic rapid pacing chooses the best ~55 beats from 110 uploaded pictures', () => {
  assert.equal(computeTargetBeatCount(60_000, 110, 'rapid-reel'), 55);
  assert.equal(computeTargetBeatCount(53_320, 110, 'rapid-reel'), 48);
});

test('explicit 1-to-1 upload mode retains intentional per-picture cutting', () => {
  assert.equal(computeTargetBeatCount(60_000, 60, 'upload-match'), 60);
  assert.equal(computeTargetBeatCount(60_000, 110, 'upload-match'), 110);
});

test('very short voiceover is never assigned more than safe scene count', () => {
  assert.equal(computeTargetBeatCount(2_000, 110, 'rapid-reel'), 4);
});

import { computeDynamicSceneTimings } from '../server/services/sceneAligner.ts';

test('uneven clauses cannot consume the final shot or exceed the narration', () => {
  for (const [count, duration] of [[2, 200], [20, 2000], [55, 60000]]) {
    const scenes = computeDynamicSceneTimings(Array.from({ length: count }, (_, i) => ({
      text: i ? 'one' : 'long '.repeat(1000), imageId: 'x', matchReason: 'test',
      emotionalWeight: 1, kenBurnsDirection: 'zoom-in',
    })), duration, []);
    assert.equal(scenes[0].startMs, 0);
    assert.equal(scenes.at(-1)?.endMs, duration);
    assert.ok(scenes.every((s, i) => s.endMs > s.startMs && s.durationMs === s.endMs - s.startMs &&
      (i === 0 || s.startMs === scenes[i - 1].endMs)));
    assert.equal(scenes.reduce((n, s) => n + s.durationMs, 0), duration);
  }
});
