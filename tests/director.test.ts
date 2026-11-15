import assert from 'node:assert/strict';
import test from 'node:test';
import { planMotion, estimateWords, attachSpeech } from '../src/director/planner.ts';
import { buildMotionSvg, wrapText } from '../src/director/composition.ts';
import {
  DIRECTOR_PRESETS,
  MOTION_TRANSITIONS,
  type SpeechAlignment,
} from '../src/director/types.ts';
import { validateMotionScenes } from '../src/director/validation.ts';
import { alignTranscriptToScript } from '../server/services/speechAligner.ts';
import { computeSfxSchedule, DEFAULT_SFX_CONFIG } from '../src/utils/sfxSchedule.ts';
import { planDirectorTransitions } from '../src/utils/directorTransitions.ts';
import type { SceneItem } from '../src/types/studio.ts';

const scenes: SceneItem[] = Array.from({ length: 12 }, (_, i) => ({
  id: `scene_${i}`,
  index: i,
  text:
    i === 0
      ? '200,000 followers in 8 days'
      : i === 3
        ? 'But the idea changes everything'
        : `An important concept number ${i}`,
  startMs: i * 1500,
  endMs: (i + 1) * 1500,
  durationMs: 1500,
  imageId: `img_${i}`,
  matchReason: 'fixture',
  emotionalWeight: 1,
  kenBurnsDirection: 'zoom-in',
  snappedToPause: false,
  alignmentSource: 'estimated',
}));
const alignment: SpeechAlignment = {
  engine: 'estimated',
  coverage: 0,
  words: estimateWords(scenes),
};

test('all five presets produce valid, varied plans with intentional quiet beats', () => {
  for (const preset of DIRECTOR_PRESETS) {
    const plan = planMotion(scenes, preset.id, alignment);
    validateMotionScenes(plan.scenes);
    assert.ok(plan.scenes.some((s) => s.motion?.quiet));
    assert.ok(new Set(plan.scenes.map((s) => s.motion?.layout)).size >= 3);
    assert.ok(plan.scenes.every((s) => MOTION_TRANSITIONS.includes(s.motion!.transition)));
    assert.equal(plan.scenes.map((s) => s.text).join(' '), scenes.map((s) => s.text).join(' '));
    assert.ok(plan.report.notices.some((n) => /estimated/i.test(n)));
  }
});

test('scene metadata stays intact and numbers are copied from the exact narration', () => {
  const planned = planMotion(scenes, 'editorial-motion', alignment).scenes;
  assert.equal(planned[0].motion?.accent, '200,000 followers');
  assert.equal(planned[0].imageId, scenes[0].imageId);
  assert.equal(planned[0].startMs, 0);
  assert.equal(planned.at(-1)?.endMs, 18000);
});

test('speech anchors move shot boundaries while preserving every script word', () => {
  const two = scenes
    .slice(0, 2)
    .map((s, i) => ({
      ...s,
      text: i ? 'Green follows.' : 'Red opens.',
      startMs: i * 1000,
      endMs: (i + 1) * 1000,
      durationMs: 1000,
    }));
  const speech = alignTranscriptToScript(
    'Red opens. Green follows.',
    [
      { text: 'Red', startMs: 100, endMs: 300 },
      { text: 'opens', startMs: 300, endMs: 600 },
      { text: 'Green', startMs: 1250, endMs: 1500 },
      { text: 'follows', startMs: 1500, endMs: 1800 },
    ],
    2000
  );
  const result = attachSpeech(two, speech, 2000);
  assert.equal(result[0].endMs, 1250);
  assert.equal(result[1].startMs, 1250);
  assert.equal(result[1].words?.[0].text, 'Green');
  assert.equal(result[1].alignmentSource, 'voice-locked');
  assert.throws(
    () => attachSpeech(two, { ...speech, words: speech.words.slice(1) }, 2000),
    /no longer matches/
  );
});

test('transcription mismatches are explicit and unmatched script words stay labeled inferred', () => {
  const result = alignTranscriptToScript(
    'Red opens our story.',
    [
      { text: 'Red', startMs: 0, endMs: 300 },
      { text: 'opens', startMs: 300, endMs: 600 },
      { text: 'story', startMs: 900, endMs: 1300 },
    ],
    1500
  );
  assert.equal(result.coverage, 0.75);
  assert.equal(result.words[2].text, 'our');
  assert.equal(result.words[2].source, 'inferred');
  assert.ok(result.words[2].startMs >= 600 && result.words[2].endMs <= 900);
  assert.throws(
    () =>
      alignTranscriptToScript(
        'A completely different script.',
        [{ text: 'Red', startMs: 0, endMs: 500 }],
        1000
      ),
    /matches the speech/
  );
});

test('shared composition animates at timestamps and escapes all user text', () => {
  const plan = planMotion(
    [{ ...scenes[0], text: '<script>alert("x")</script> & one idea' }],
    'editorial-motion',
    { ...alignment, words: [] }
  ).scenes[0];
  const a = buildMotionSvg(plan, 0, '9:16'),
    b = buildMotionSvg(plan, 600, '9:16');
  assert.notEqual(a, b);
  assert.ok(!b.includes('<script>'));
  assert.ok(b.includes('&lt;script&gt;'));
  assert.ok(!/NaN|Infinity/.test(b));
  assert.ok(wrapText('But your story matters', 810, 76).length >= 2);
});

test('sound cues follow animation timestamps and respect a three-cue/second cap', () => {
  const plan = planMotion(scenes, 'rapid-viral', alignment);
  const cues = computeSfxSchedule(plan.scenes, DEFAULT_SFX_CONFIG, 18000);
  assert.ok(cues.some((c) => c.cue === 'cashtick'));
  assert.ok(
    plan.scenes
      .filter((s) => s.motion?.quiet)
      .every((s) => !cues.some((c) => c.atMs >= s.startMs && c.atMs < s.endMs))
  );
  assert.ok(
    cues.every((c) => cues.filter((x) => x.atMs <= c.atMs && c.atMs - x.atMs < 1000).length <= 3)
  );
});

test('motion transition choices reach the frame planner and invalid filters fail before rendering', () => {
  const plan = planMotion(scenes, 'editorial-motion', alignment).scenes;
  plan[1].motion!.transition = 'circleopen';
  const boundaries = planDirectorTransitions(
    plan,
    plan.map(() => 45),
    'whip-dynamic'
  );
  assert.equal(boundaries[0].transition, 'circleopen');
  plan[1].motion!.transition = 'movie=/private/file' as never;
  assert.throws(() => validateMotionScenes(plan), /Invalid motion plan/);
});

import { buildDynamicCaptionFrames } from '../src/utils/captions.ts';
test('legacy caption effects honor recognized word timestamps instead of evenly dividing the scene', () => {
  const shot = {
    ...scenes[1],
    text: 'Red opens.',
    startMs: 0,
    endMs: 1500,
    durationMs: 1500,
    words: [
      { text: 'Red', startMs: 150, endMs: 400, source: 'speech' as const },
      { text: 'opens.', startMs: 900, endMs: 1400, source: 'speech' as const },
    ],
  };
  const frames = buildDynamicCaptionFrames(shot, 'word-pop', 'kinetic-karaoke', '9:16');
  assert.deepEqual(
    frames.map((f) => [f.startMs, f.endMs]),
    [
      [150, 400],
      [900, 1400],
    ]
  );
});

test('hook headline persists across image cuts while its qualifier waits for the spoken phrase', () => {
  const shots = [
    { ...scenes[0], text: '200,000 followers', startMs: 0, endMs: 1000, durationMs: 1000 },
    { ...scenes[1], text: 'in 8 days', startMs: 1000, endMs: 2000, durationMs: 1000 },
  ];
  const plan = planMotion(shots, 'editorial-motion', {
    engine: 'estimated',
    coverage: 0,
    words: estimateWords(shots),
  });
  validateMotionScenes(plan.scenes);
  assert.equal(plan.scenes[1].motion?.headline, '200,000 followers');
  assert.equal(plan.scenes[1].motion?.originMs, 0);
  assert.equal(plan.scenes[1].motion?.secondaryAtMs, 1000);
});
