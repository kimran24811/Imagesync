import type {
  AccentColorId,
  AspectRatio,
  CaptionMode,
  SceneItem,
  TextEffectId,
} from '../types/studio.ts';

export const ACCENT_COLOR_HEX: Record<AccentColorId, { hex: string; label: string }> = {
  coral: { hex: '#F43F5E', label: 'Coral Pink' },
  gold: { hex: '#F59E0B', label: 'Amber Gold' },
  cyan: { hex: '#38BDF8', label: 'Electric Cyan' },
  emerald: { hex: '#10B981', label: 'Emerald' },
};

export interface CaptionWordToken {
  raw: string;
  display: string;
  isAccent: boolean;
  isNumeric: boolean;
  isActiveWord: boolean;
}

export interface DynamicCaptionFrame {
  id: string;
  startMs: number;
  endMs: number;
  isRtl: boolean;
  words: CaptionWordToken[];
}

export function isRtlText(text: string): boolean {
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

function normalizeUnicodeToken(word: string): string {
  return word.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
}

export function detectPreviewAccentTokens(text: string, explicitAccent?: string): Set<string> {
  const cleanAccent = (explicitAccent ?? '').replace(/\*/g, '').trim();

  const accentSet = new Set<string>();
  if (cleanAccent) {
    for (const w of cleanAccent.split(/\s+/)) {
      const stripped = normalizeUnicodeToken(w);
      if (stripped) accentSet.add(stripped);
    }
    if (accentSet.size > 0) return accentSet;
  }

  const words = text.split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (/^\*[^*]+\*$/.test(w) || /\d/.test(w)) {
      const stripped = normalizeUnicodeToken(w);
      if (stripped) accentSet.add(stripped);
    }
  }
  if (accentSet.size === 0 && words.length >= 2) {
    const tail = words.slice(-2);
    for (const w of tail) {
      const stripped = normalizeUnicodeToken(w);
      if (stripped.length >= 2) accentSet.add(stripped);
    }
  }
  return accentSet;
}

function splitIntoPhraseChunks(
  scene: SceneItem,
  maxWordsPerChunk: number
): Array<{ startMs: number; endMs: number; words: string[] }> {
  const clean = scene.text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const allWords = clean.split(/\s+/);
  if (allWords.length <= maxWordsPerChunk) {
    return [{ startMs: scene.startMs, endMs: scene.endMs, words: allWords }];
  }

  const chunkCount = Math.max(2, Math.ceil(allWords.length / maxWordsPerChunk));
  const wordsPerChunk = Math.ceil(allWords.length / chunkCount);
  const totalWords = allWords.length;
  const result: Array<{ startMs: number; endMs: number; words: string[] }> = [];
  let cursorMs = scene.startMs;

  for (let i = 0; i < chunkCount; i++) {
    const slice = allWords.slice(i * wordsPerChunk, (i + 1) * wordsPerChunk);
    if (slice.length === 0) continue;

    const isLast = i === chunkCount - 1 || (i + 1) * wordsPerChunk >= totalWords;
    const chunkDur = isLast
      ? scene.endMs - cursorMs
      : Math.round((slice.length / totalWords) * (scene.endMs - scene.startMs));
    const nextEndMs = isLast ? scene.endMs : Math.min(scene.endMs, cursorMs + chunkDur);

    result.push({
      startMs: cursorMs,
      endMs: nextEndMs,
      words: slice,
    });
    cursorMs = nextEndMs;
  }

  return result;
}

/**
 * Generates timed dynamic caption steps aligned word-by-word to the beat.
 * Rapid 1-2s beats get tight 2-3 word bursts so captions snap in sync with rapid visuals.
 */
export function buildDynamicCaptionFrames(
  scene: SceneItem,
  captionMode: CaptionMode,
  textEffect: TextEffectId,
  aspectRatio: AspectRatio
): DynamicCaptionFrame[] {
  if (captionMode === 'off') return [];

  const clean = scene.text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];

  const isRtl = isRtlText(clean);
  const accentSet = detectPreviewAccentTokens(clean, scene.accentPhrase);

  const maxWordsPerPhrase =
    captionMode === 'word-pop'
      ? 2
      : captionMode === 'bottom-third'
        ? aspectRatio === '9:16'
          ? 6
          : 10
        : aspectRatio === '9:16'
          ? 4
          : 6;

  const phraseChunks = splitIntoPhraseChunks(scene, maxWordsPerPhrase);
  const frames: DynamicCaptionFrame[] = [];

  for (let cIdx = 0; cIdx < phraseChunks.length; cIdx++) {
    const chunk = phraseChunks[cIdx];
    const chunkDur = chunk.endMs - chunk.startMs;
    if (chunkDur <= 0) continue;

    if (
      (textEffect === 'type-reveal' || textEffect === 'kinetic-karaoke') &&
      chunk.words.length > 1 &&
      chunkDur >= 240
    ) {
      const stepCount = chunk.words.length;
      const stepDur = chunkDur / stepCount;

      for (let wIdx = 0; wIdx < stepCount; wIdx++) {
        const sMs = Math.round(chunk.startMs + wIdx * stepDur);
        const eMs =
          wIdx === stepCount - 1
            ? chunk.endMs
            : Math.round(chunk.startMs + (wIdx + 1) * stepDur);

        const visibleWords =
          textEffect === 'type-reveal' ? chunk.words.slice(0, wIdx + 1) : chunk.words;

        frames.push({
          id: `${scene.id}_c${cIdx}_w${wIdx}`,
          startMs: sMs,
          endMs: Math.min(chunk.endMs, eMs),
          isRtl,
          words: visibleWords.map((raw, idx) => {
            const display = raw.replace(/\*/g, '');
            const key = normalizeUnicodeToken(display);
            const isStarred = /\*[^*]+\*/.test(raw);
            return {
              raw,
              display,
              isAccent: isStarred || (key.length > 0 && accentSet.has(key)),
              isNumeric: /\d/.test(display),
              isActiveWord: idx === wIdx,
            };
          }),
        });
      }
    } else {
      frames.push({
        id: `${scene.id}_c${cIdx}`,
        startMs: chunk.startMs,
        endMs: chunk.endMs,
        isRtl,
        words: chunk.words.map((raw, idx) => {
          const display = raw.replace(/\*/g, '');
          const key = normalizeUnicodeToken(display);
          const isStarred = /\*[^*]+\*/.test(raw);
          return {
            raw,
            display,
            isAccent: isStarred || (key.length > 0 && accentSet.has(key)),
            isNumeric: /\d/.test(display),
            isActiveWord: idx === chunk.words.length - 1,
          };
        }),
      });
    }
  }

  return frames;
}

export function getActiveDynamicFrame(
  scene: SceneItem,
  currentTimeMs: number,
  captionMode: CaptionMode,
  textEffect: TextEffectId,
  aspectRatio: AspectRatio
): DynamicCaptionFrame | null {
  const frames = buildDynamicCaptionFrames(scene, captionMode, textEffect, aspectRatio);
  if (frames.length === 0) return null;
  const found = frames.find((f) => currentTimeMs >= f.startMs && currentTimeMs < f.endMs);
  return found ?? null;
}
