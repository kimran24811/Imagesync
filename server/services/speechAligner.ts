import { fileURLToPath } from 'node:url';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { SpeechAlignment, TimedWord } from '../../src/director/types.ts';
import { runCommand } from './execUtils.ts';

export const speechRoot = () => path.resolve('workspace_data', '_speech');
const pythonPath = () =>
  process.env.SPEECH_PYTHON?.trim() ||
  path.join(
    speechRoot(),
    'venv',
    process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'
  );
export async function getSpeechStatus() {
  try {
    await runCommand(pythonPath(), ['-c', 'import faster_whisper'], 15000);
    return {
      available: true,
      model: process.env.SPEECH_MODEL || 'base',
      message: 'Local CPU word timestamps are available. The model downloads once if needed.',
    };
  } catch {
    return {
      available: false,
      model: process.env.SPEECH_MODEL || 'base',
      message:
        'Enable local word timing with Set up speech, or run npm run setup:speech. Python 3.10–3.12 is required. Estimated timing remains explicitly available.',
    };
  }
}
const normalize = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');

/** Monotonic sequence alignment: never substitute recognized words for the user's script. */
export function alignTranscriptToScript(
  script: string,
  transcript: Array<{ text: string; startMs: number; endMs: number }>,
  durationMs: number
): SpeechAlignment {
  const tokens = script.trim().split(/\s+/).filter(Boolean);
  const spoken = transcript.filter(
    (w) =>
      normalize(w.text) &&
      Number.isFinite(w.startMs) &&
      Number.isFinite(w.endMs) &&
      w.endMs > w.startMs &&
      w.startMs >= 0 &&
      w.startMs < durationMs
  );
  if (!tokens.length || !spoken.length || tokens.length > 2000 || spoken.length > 3000)
    throw new Error('Speech alignment returned no usable words or exceeds the short-reel limit.');
  if (spoken.some((w, i) => i > 0 && w.startMs < spoken[i - 1].startMs))
    throw new Error('Speech word timestamps are not chronological.');
  const n = tokens.length,
    m = spoken.length,
    costs = Array.from({ length: n + 1 }, () => new Float32Array(m + 1));
  for (let i = 0; i <= n; i++) costs[i][0] = i;
  for (let j = 0; j <= m; j++) costs[0][j] = j;
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) {
      const same = normalize(tokens[i - 1]) === normalize(spoken[j - 1].text);
      costs[i][j] = Math.min(
        costs[i - 1][j] + 1,
        costs[i][j - 1] + 1,
        costs[i - 1][j - 1] + (same ? 0 : 1.5)
      );
    }
  const anchors = new Map<number, (typeof spoken)[number]>();
  let i = n,
    j = m;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      normalize(tokens[i - 1]) === normalize(spoken[j - 1].text) &&
      costs[i][j] === costs[i - 1][j - 1]
    ) {
      anchors.set(--i, spoken[--j]);
    } else if (i > 0 && (j === 0 || costs[i][j] === costs[i - 1][j] + 1)) i--;
    else if (j > 0 && (i === 0 || costs[i][j] === costs[i][j - 1] + 1)) j--;
    else {
      i--;
      j--;
    }
  }
  const coverage = anchors.size / n;
  if (coverage < 0.65)
    throw new Error(
      `Only ${Math.round(coverage * 100)}% of the script matches the speech. Check the script language/wording and voiceover, or select estimated timing explicitly.`
    );
  const words: TimedWord[] = tokens.map((text, index) => {
    const anchor = anchors.get(index);
    return {
      text,
      startMs: anchor?.startMs ?? -1,
      endMs: Math.min(durationMs, anchor?.endMs ?? -1),
      source: anchor ? 'speech' : 'inferred',
    };
  });
  // Interpolate only unmatched runs and label them inferred, never speech-locked.
  for (let start = 0; start < n;) {
    if (words[start].source === 'speech') {
      start++;
      continue;
    }
    let end = start;
    while (end < n && words[end].source === 'inferred') end++;
    const low = start ? words[start - 1].endMs : 0,
      high = end < n ? words[end].startMs : durationMs;
    const span = Math.max(0, high - low);
    for (let k = start; k < end; k++) {
      words[k].startMs = Math.round(low + (span * (k - start)) / (end - start));
      words[k].endMs = Math.round(low + (span * (k - start + 1)) / (end - start));
    }
    start = end;
  }
  for (let k = 0; k < n; k++) {
    words[k].startMs = Math.max(k ? words[k - 1].endMs : 0, words[k].startMs);
    words[k].endMs = Math.min(durationMs, Math.max(words[k].startMs, words[k].endMs));
  }
  return {
    engine: 'faster-whisper',
    coverage,
    words,
    notice:
      coverage < 1
        ? `${n - anchors.size} script words were inferred between speech anchors; review those captions.`
        : undefined,
  };
}
export async function alignSpeech(
  audioPath: string,
  script: string,
  durationMs: number
): Promise<SpeechAlignment> {
  const status = await getSpeechStatus();
  if (!status.available) throw new Error(status.message);
  const cacheDir = path.join(speechRoot(), 'cache');
  await fs.mkdir(cacheDir, { recursive: true });
  const audio = await fs.readFile(audioPath);
  const hash = crypto
    .createHash('sha256')
    .update('speech-v1')
    .update(status.model)
    .update(script)
    .update(audio)
    .digest('hex');
  const cache = path.join(cacheDir, `${hash}.json`);
  try {
    const stored = JSON.parse(await fs.readFile(cache, 'utf8')) as SpeechAlignment;
    if (stored.engine === 'faster-whisper' && stored.words.length) return stored;
  } catch {}
  const result = await runCommand(
    pythonPath(),
    [
      fileURLToPath(new URL('../scripts/transcribe.py', import.meta.url)),
      '--audio',
      audioPath,
      '--model',
      status.model,
      '--cache',
      process.env.SPEECH_CACHE_DIR || path.join(speechRoot(), 'models'),
      ...(process.env.SPEECH_LANGUAGE ? ['--language', process.env.SPEECH_LANGUAGE] : []),
    ],
    15 * 60_000
  );
  const parsed = JSON.parse(result.stdout) as {
    words: Array<{ text: string; startMs: number; endMs: number }>;
  };
  const alignment = alignTranscriptToScript(script, parsed.words, durationMs);
  await fs.writeFile(cache, JSON.stringify(alignment), 'utf8');
  return alignment;
}
