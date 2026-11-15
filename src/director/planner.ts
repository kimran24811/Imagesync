import type { SceneItem } from '../types/studio.ts';
import {
  DIRECTOR_PRESETS,
  type DirectorPresetId,
  type DirectorReport,
  type MotionDesign,
  type MotionLayout,
  type SpeechAlignment,
  type TimedWord,
} from './types.ts';

const wordsOf = (text: string) => text.trim().split(/\s+/).filter(Boolean);
const KEYWORDS =
  /\b(but|however|instead|never|secret|mistake|stop|why|imagine|finally|suddenly)\b/i;
export function emphasisFrom(text: string): string {
  const numeric = text.match(
    /(?:[$£€₹]\s*)?\d[\d,.]*(?:\s*(?:%|million|billion|thousand|days?|hours?|years?|followers|views|rupees|dollars))?/i
  )?.[0];
  if (numeric) return numeric;
  const words = wordsOf(text);
  return words.slice(Math.max(0, words.length - 2)).join(' ');
}
export function estimateWords(scenes: SceneItem[]): TimedWord[] {
  return scenes.flatMap((s) => {
    const tokens = wordsOf(s.text);
    return tokens.map((text, i) => ({
      text,
      startMs: Math.round(s.startMs + ((s.endMs - s.startMs) * i) / tokens.length),
      endMs: Math.round(s.startMs + ((s.endMs - s.startMs) * (i + 1)) / tokens.length),
      source: 'inferred' as const,
    }));
  });
}

/** Preserve script order and phrase identity. Timings are adjusted only when the exact token sequence matches. */
export function attachSpeech(
  scenes: SceneItem[],
  alignment: SpeechAlignment,
  durationMs: number
): SceneItem[] {
  const normalize = (s: string) => s.replace(/\s+/g, ' ').trim();
  if (
    normalize(scenes.map((s) => s.text).join(' ')) !==
    normalize(alignment.words.map((w) => w.text).join(' '))
  ) {
    throw new Error(
      'The storyboard text no longer matches the script. Reanalyze before applying speech timing.'
    );
  }
  let cursor = 0;
  const groups = scenes.map((scene) => {
    const count = wordsOf(scene.text).length;
    const words = alignment.words.slice(cursor, cursor + count);
    cursor += count;
    return words;
  });
  const cuts = [0];
  for (let i = 1; i < scenes.length; i++) {
    const onset = groups[i][0]?.startMs ?? scenes[i].startMs;
    const min = cuts[i - 1] + 34,
      max = durationMs - (scenes.length - i) * 34;
    if (max < min) throw new Error('Too many shots for the narration; select slower pacing.');
    cuts.push(Math.round(Math.max(min, Math.min(max, onset))));
  }
  cuts.push(durationMs);
  return scenes.map((s, i) => ({
    ...s,
    startMs: cuts[i],
    endMs: cuts[i + 1],
    durationMs: cuts[i + 1] - cuts[i],
    words: groups[i],
    alignmentSource: groups[i].every((w) => w.source === 'speech') ? 'voice-locked' : 'estimated',
  }));
}

export function planMotion(
  scenes: SceneItem[],
  presetId: DirectorPresetId,
  alignment: SpeechAlignment
): { scenes: SceneItem[]; report: DirectorReport } {
  const preset = DIRECTOR_PRESETS.find((p) => p.id === presetId) ?? DIRECTOR_PRESETS[0];
  let lastLayout: MotionLayout | undefined;
  const result = scenes.map((scene, i) => {
    const numeric = /\d/.test(scene.text),
      contrast = KEYWORDS.test(scene.text);
    const quiet = preset.id === 'cinematic-story' ? i % 3 !== 0 : i > 0 && i % 5 === 4;
    let layout: MotionLayout = quiet
      ? 'minimal'
      : numeric
        ? 'stat'
        : i === 0
          ? 'headline'
          : contrast
            ? 'callout'
            : preset.id === 'educational' || i % 6 === 3
              ? 'chapter'
              : 'headline';
    if (layout === lastLayout && i > 0 && !numeric && !quiet)
      layout = i % 2 ? 'callout' : 'chapter';
    if (scene.beatKind === 'graphic-card') layout = numeric ? 'stat' : 'chapter';
    lastLayout = layout;
    const words =
      scene.words ??
      alignment.words.filter((w) => w.startMs >= scene.startMs && w.startMs < scene.endMs);
    const accent = emphasisFrom(scene.text);
    const focus = words.find((w) =>
      accent.toLowerCase().includes(w.text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))
    );
    const emphasisMs = Math.max(
      scene.startMs,
      Math.min(
        scene.endMs - 100,
        focus?.startMs ?? scene.startMs + Math.min(400, scene.durationMs * 0.3)
      )
    );
    const transition =
      i === 0 || quiet || i % preset.rhythm !== 0
        ? 'cut'
        : preset.id === 'cinematic-story'
          ? 'fade'
          : numeric
            ? 'zoomin'
            : contrast
              ? 'hblur'
              : (preset.id === 'cartoon-energy'
                  ? (['circleopen', 'squeezev', 'zoomin', 'radial', 'diagtl', 'pixelize'] as const)
                  : preset.id === 'educational'
                    ? (['wipeleft', 'smoothup', 'circleopen', 'slideup'] as const)
                    : ([
                        'slideleft',
                        'smoothup',
                        'wipeleft',
                        'slideright',
                        'diagtl',
                        'squeezeh',
                      ] as const))[
                  Math.floor(i / preset.rhythm) % (preset.id === 'educational' ? 4 : 6)
                ];
    const entrance = quiet
      ? 'rise'
      : preset.id === 'cartoon-energy'
        ? 'pop'
        : numeric
          ? 'tracking'
          : contrast
            ? 'wipe'
            : (['rise', 'slide', 'blur', 'tracking'] as const)[i % 4];
    const motion: MotionDesign = {
      version: 1,
      preset: preset.id,
      layout,
      entrance,
      headline: wordsOf(scene.text).slice(0, 10).join(' '),
      accent,
      icon: /money|dollar|rupee|profit|cost|[$£€₹]/i.test(scene.text)
        ? 'money'
        : /day|hour|minute|time|year/i.test(scene.text)
          ? 'clock'
          : /idea|think|learn/i.test(scene.text)
            ? 'idea'
            : /grow|increase|views|followers/i.test(scene.text)
              ? 'growth'
              : /[?]/.test(scene.text)
                ? 'question'
                : 'none',
      transition,
      transitionMs: preset.id === 'cinematic-story' ? 260 : 160,
      quiet,
      reason: quiet
        ? 'Pacing contrast: a quiet shot gives the next reveal room.'
        : numeric
          ? 'Emphasize the exact number from the narration.'
          : contrast
            ? 'A change in the argument gets a restrained visual accent.'
            : i === 0
              ? 'Establish the hook with a strong headline.'
              : 'Develop the concept with varied typography and framing.',
      cues: quiet
        ? []
        : [
            {
              atMs: scene.startMs,
              cue: i === 0 ? 'impact' : layout === 'chapter' ? 'whoosh' : 'pop',
              role: 'entrance',
            },
            ...(numeric
              ? [{ atMs: emphasisMs, cue: 'cashtick' as const, role: 'emphasis' as const }]
              : contrast
                ? [{ atMs: emphasisMs, cue: 'thud' as const, role: 'emphasis' as const }]
                : []),
          ],
    };
    return {
      ...scene,
      words,
      motion,
      kenBurnsDirection: quiet ? 'zoom-in' : preset.camera[i % preset.camera.length],
    };
  });
  // A hook headline can persist across the next image cut, as in the reference.
  if (
    result.length > 1 &&
    result[0].motion?.layout === 'stat' &&
    /^(?:in|within|over|after)\s/i.test(result[1].text) &&
    result[0].durationMs + result[1].durationMs <= 6000
  ) {
    const primary = result[0].motion;
    primary.originMs = result[0].startMs;
    primary.secondaryText = result[1].text;
    primary.secondaryAtMs = result[1].words?.[0]?.startMs ?? result[1].startMs;
    result[1].motion = {
      ...primary,
      transition: 'cut',
      cues: [{ atMs: result[1].startMs, cue: 'pop', role: 'emphasis' }],
      reason: 'Hold the hook headline across the image change and reveal its qualifier on speech.',
    };
  }
  return {
    scenes: result,
    report: {
      version: 1,
      preset: preset.id,
      engine: 'rules-v1',
      alignment: {
        engine: alignment.engine,
        coverage: alignment.coverage,
        notice: alignment.notice,
      },
      notices: [
        ...(alignment.notice ? [alignment.notice] : []),
        ...(alignment.engine === 'estimated'
          ? [
              'Speech timing is estimated. Enable local speech alignment for spoken-word synchronization.',
            ]
          : []),
      ],
      effectCount: result.filter((s) => !s.motion?.quiet).length,
    },
  };
}
