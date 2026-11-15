import assert from 'node:assert/strict';
import test from 'node:test';
import type { SceneItem } from '../src/types/studio.ts';
import { planDirectorTransitions } from '../src/utils/directorTransitions.ts';

const beat = (index: number, overrides: Partial<SceneItem> = {}): SceneItem => ({
  id: 'beat_' + index,
  index, text: 'Concept ' + index,
  startMs: index * 1000, endMs: (index + 1) * 1000,
  durationMs: 1000, imageId: 'media_1', matchReason: 'test',
  emotionalWeight: 1, kenBurnsDirection: 'zoom-in',
  snappedToPause: false, alignmentSource: 'estimated',
  beatKind: 'media', sfxCue: 'pop', ...overrides,
});

test('director edits use mostly snap cuts, with accented transitions', () => {
  const scenes = Array.from({ length: 9 }, (_, i) => beat(i));
  scenes[5] = beat(5, { beatKind: 'graphic-card', sfxCue: 'cashtick' });
  const result = planDirectorTransitions(scenes, scenes.map(() => 30), 'whip-dynamic');
  assert.equal(result.length, 8);
  assert.ok(result.filter((x) => x.kind === 'snap').length >= 4);
  assert.equal(result[4].kind, 'flash');
  assert.ok(result.some((x) => x.kind === 'whip'));
});

test('literal cut mode emits no crossfade boundaries', () => {
  assert.deepEqual(planDirectorTransitions([beat(0), beat(1)], [30, 30], 'cut'), []);
});

test('very short shots clamp transitions safely', () => {
  const scenes = [beat(0), beat(1, { emotionalWeight: 1.5 }), beat(2)];
  const result = planDirectorTransitions(scenes, [8, 8, 8], 'whip-dynamic');
  assert.ok(result.every((x) => x.overlapFrames <= 2));
});

test('crossfades use explicit frame-based timing', () => {
  const scenes = [beat(0), beat(1)];
  const result = planDirectorTransitions(scenes, [30, 30], 'crossfade', 280, 30);
  assert.equal(result[0].overlapFrames, 8);
  assert.equal(result[0].transition, 'fade');
});

test('invalid scene plans fail before FFmpeg starts', () => {
  assert.throws(() => planDirectorTransitions([beat(0)], [], 'whip-dynamic'));
  assert.throws(() => planDirectorTransitions([beat(0)], [30], 'cut', 200, 0));
});
