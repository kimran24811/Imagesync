import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { alignSpeech } from '../../server/services/speechAligner.ts';

test(
  'real local speech model recognizes the fixture and anchors the exact script to audio',
  { timeout: 600000 },
  async () => {
    const audio = fileURLToPath(new URL('../fixtures/red.wav', import.meta.url));
    const result = await alignSpeech(audio, 'Red opens our story.', 2400);
    assert.equal(result.engine, 'faster-whisper');
    assert.equal(result.coverage, 1);
    assert.deepEqual(
      result.words.map((w) => w.text),
      ['Red', 'opens', 'our', 'story.']
    );
    assert.ok(result.words.every((w) => w.source === 'speech' && w.endMs > w.startMs));
    assert.ok(result.words[0].startMs < 250);
    assert.ok(result.words.at(-1)!.endMs > 1100 && result.words.at(-1)!.endMs < 1900);
  }
);
