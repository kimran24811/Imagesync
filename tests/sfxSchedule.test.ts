import assert from 'node:assert/strict';
import test from 'node:test';
import type { SceneItem } from '../src/types/studio.ts';
import { computeSfxSchedule, DEFAULT_SFX_CONFIG } from '../src/utils/sfxSchedule.ts';

const scene = (index: number, cue: SceneItem['sfxCue']): SceneItem => ({
  id: 'scene_' + index, index, text: index ? 'A big number 200' : 'The hook',
  startMs: index * 1100, endMs: (index + 1) * 1100, durationMs: 1100,
  imageId: 'image_1', matchReason: 'test', emotionalWeight: 1.1,
  kenBurnsDirection: 'zoom-in', snappedToPause: false,
  alignmentSource: 'estimated', beatKind: index === 1 ? 'graphic-card' : 'media',
  sfxCue: cue,
});

test('hook and graphic-card accents coexist without overload', () => {
  const events = computeSfxSchedule(
    [scene(0, 'pop'), scene(1, 'cashtick')],
    DEFAULT_SFX_CONFIG, 2200
  );
  assert.ok(events.some((e) => e.cue === 'impact' && e.atMs === 0));
  assert.ok(events.some((e) => e.cue === 'cashtick'));
  assert.ok(events.some((e) => e.cue === 'chime'));
});

test('SFX events stay sorted and do not stack three at the same instant', () => {
  const events = computeSfxSchedule(
    Array.from({ length: 8 }, (_, i) => scene(i, i % 2 ? 'whoosh' : 'pop')),
    DEFAULT_SFX_CONFIG, 9000
  );
  assert.deepEqual(events.map((e) => e.atMs), events.map((e) => e.atMs).sort((a, b) => a - b));
  assert.ok(events.every((ev) =>
    events.filter((other) => Math.abs(other.atMs - ev.atMs) < 65).length <= 2
  ));
});
