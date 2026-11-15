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
