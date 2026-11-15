import fs from 'node:fs/promises';
import { Type } from '@google/genai';
import type {
  AlignmentSource,
  BeatKind,
  CaptionZone,
  FocalCropRegion,
  GraphicCardData,
  GraphicCardTheme,
  KenBurnsDirection,
  MatchingPreference,
  MediaType,
  PacingMode,
  SceneItem,
  SfxCueType,
  SpeechPause,
  UploadedImage,
} from '../../src/types/studio.ts';
import {
  ALL_ACTIVE_SFX_CUES,
  inferDefaultSfxCue,
} from '../../src/utils/sfxSchedule.ts';
import { getGeminiClient, isGeminiConfigured } from './geminiClient.ts';
import { orderMediaByShotNumber, selectMediaForBeat } from '../../src/utils/orderedMedia.ts';

export interface InternalMediaPayload {
  id: string;
  originalName: string;
  mediaType: MediaType;
  clipDurationMs?: number;
  thumbPath: string;
  width: number;
  height: number;
}

interface AlignScenesInput {
  rawScript: string;
  audioDurationMs: number;
  audioProxyPath?: string;
  pauses: SpeechPause[];
  images: InternalMediaPayload[];
  matchingPreference: MatchingPreference;
  pacingMode?: PacingMode;
  graphicCardTheme?: GraphicCardTheme;
}

interface AlignScenesOutput {
  scenes: SceneItem[];
  imageSummaries: Record<string, string>;
  engineUsed: 'gemini-4-hydrogen' | 'local-heuristic';
  fallbackNotice?: string;
}

interface GeminiResponsePayload {
  imageDescriptions?: Array<{
    imageId?: string;
    visualSummary?: string;
  }>;
  scenes?: Array<{
    text?: string;
    imageId?: string;
    matchReason?: string;
    emotionalWeight?: number;
    kenBurnsDirection?: string;
    beatKind?: string;
    focalCrop?: string;
    captionZone?: string;
    statValue?: string;
    statUnit?: string;
    kicker?: string;
    accentPhrase?: string;
    sfxCue?: string;
    startMs?: number;
    endMs?: number;
  }>;
}

const KINETIC_DIRECTIONS: KenBurnsDirection[] = [
  'snap-zoom-in',
  'whip-zoom',
  'pan-left',
  'pan-right',
  'impact-shake',
  'zoom-out',
  'pan-up',
  'zoom-in',
];

const VALID_DIRECTIONS = new Set<KenBurnsDirection>(KINETIC_DIRECTIONS);

function sanitizeDirection(dir: string | undefined, idx: number, beatKind?: BeatKind): KenBurnsDirection {
  if (dir && VALID_DIRECTIONS.has(dir as KenBurnsDirection)) {
    return dir as KenBurnsDirection;
  }
  if (idx === 0) return 'impact-shake';
  if (beatKind === 'graphic-card') return 'snap-zoom-in';
  const rapidCycle: KenBurnsDirection[] = [
    'snap-zoom-in',
    'pan-left',
    'whip-zoom',
    'pan-right',
    'snap-zoom-in',
    'pan-up',
  ];
  return rapidCycle[idx % rapidCycle.length];
}

const SUB_CROPS: FocalCropRegion[] = [
  'left-focus',
  'right-focus',
  'tight-macro',
  'top-hero',
  'bottom-detail',
  'full',
];

const VALID_CROPS = new Set<FocalCropRegion>(SUB_CROPS);

function sanitizeFocalCrop(crop: string | undefined, fallback: FocalCropRegion = 'full'): FocalCropRegion {
  if (crop && VALID_CROPS.has(crop as FocalCropRegion)) {
    return crop as FocalCropRegion;
  }
  return fallback;
}

const VALID_ZONES = new Set<CaptionZone>(['top-banner', 'center-impact', 'lower-hero']);

function sanitizeCaptionZone(zone: string | undefined, text: string, idx: number): CaptionZone {
  if (zone && VALID_ZONES.has(zone as CaptionZone)) {
    return zone as CaptionZone;
  }
  const wordCount = text.trim().split(/\s+/).length;
  if (wordCount <= 3 && idx % 3 === 1) return 'center-impact';
  if (idx % 4 === 3) return 'lower-hero';
  return 'top-banner';
}

const VALID_SFX_SET = new Set<string>(['none', ...ALL_ACTIVE_SFX_CUES]);

function sanitizeSfxCue(
  cue: string | undefined,
  text: string,
  idx: number,
  accentPhrase?: string,
  beatKind?: BeatKind
): SfxCueType {
  if (cue && VALID_SFX_SET.has(cue)) {
    return cue as SfxCueType;
  }
  return inferDefaultSfxCue(text, idx, accentPhrase, beatKind);
}

function inferAccentPhrase(text: string): string {
  const numMatch = text.match(
    /(\$?\d[\d,.]*(?:\s*(?:days|hours|minutes|years|million|billion|k|m|%|\+|views|followers|rupees))?)/i
  );
  if (numMatch?.[1]) return numMatch[1].trim();
  const cleanWords = text
    .replace(/[^\p{L}\p{N}\s'-]/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (cleanWords.length >= 2) {
    return cleanWords.slice(-2).join(' ');
  }
  return cleanWords[0] ?? '';
}

function extractNumericStat(text: string): { statValue: string; statUnit?: string } | null {
  const m = text.match(
    /(\$?\d[\d,.]*\s*(?:%|M|K|B|\+)?)(?:\s+([A-Za-z\u0600-\u06FF]{2,14}))?/i
  );
  if (!m?.[1]) return null;
  const statValue = m[1].replace(/\s+/g, '').trim();
  const unitCandidate = (m[2] ?? '').trim();
  const statUnit = unitCandidate ? unitCandidate.toUpperCase() : undefined;
  return { statValue, statUnit };
}

function detectContrastPair(text: string, prevText?: string): { left: string; right: string } | null {
  const vsMatch = text.match(/^(.{2,18})\s+(?:vs\.?|versus|or|against|to)\s+(.{2,18})$/i);
  if (vsMatch) {
    return {
      left: vsMatch[1].replace(/[^\p{L}\p{N}\s]/gu, '').trim().toUpperCase(),
      right: vsMatch[2].replace(/[^\p{L}\p{N}\s]/gu, '').trim().toUpperCase(),
    };
  }
  const andMatch = text.match(/\b([A-Za-z]{3,12})\s+and\s+([A-Za-z]{3,12})\b/i);
  if (andMatch && !prevText) {
    return {
      left: andMatch[1].toUpperCase(),
      right: andMatch[2].toUpperCase(),
    };
  }
  return null;
}

export function computeTargetBeatCount(
  audioDurationMs: number,
  mediaCount: number,
  pacingMode: PacingMode
): number {
  // Guard against more cuts than the soundtrack can support (minimum 480ms/beat).
  const maxSafeBeats = Math.max(1, Math.floor(audioDurationMs / 480));
  if (pacingMode === 'upload-match') {
    return Math.max(1, Math.min(mediaCount, maxSafeBeats));
  }
  const msPerBeat = pacingMode === 'rapid-reel' ? 1350 : 1950;
  const maxBeats = pacingMode === 'rapid-reel' ? 72 : 55;
  const cadenceTarget = Math.max(4, Math.round(audioDurationMs / msPerBeat));
  return Math.max(1, Math.min(maxSafeBeats, Math.max(mediaCount, Math.min(maxBeats, cadenceTarget))));
}

export async function alignScriptAndImages(
  input: AlignScenesInput
): Promise<AlignScenesOutput> {
  const cleanScript = input.rawScript.replace(/\s+/g, ' ').trim();
  if (!cleanScript) {
    throw new Error('Voiceover script cannot be empty.');
  }
  if (input.images.length === 0) {
    throw new Error('At least one photo or video clip is required to build a video timeline.');
  }

  const pacingMode: PacingMode = input.pacingMode ?? 'rapid-reel';
  const cardTheme: GraphicCardTheme = input.graphicCardTheme ?? 'obsidian';
  const targetBeatCount = computeTargetBeatCount(
    input.audioDurationMs,
    input.images.length,
    pacingMode
  );

  const wantsGemini = input.matchingPreference !== 'local';
  const client = wantsGemini ? getGeminiClient() : null;

  if (wantsGemini && client) {
    try {
      const geminiResult = await alignWithGeminiMultimodal(
        client,
        cleanScript,
        input.audioDurationMs,
        input.audioProxyPath,
        input.pauses,
        input.images,
        targetBeatCount,
        pacingMode,
        cardTheme
      );
      return geminiResult;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gemini multimodal request failed';
      if (input.matchingPreference === 'gemini') {
        throw new Error(`Gemini alignment failed: ${msg}`);
      }
      const fallback = alignWithLocalHeuristic(
        cleanScript,
        input.audioDurationMs,
        input.pauses,
        input.images,
        targetBeatCount,
        pacingMode,
        cardTheme
      );
      return {
        ...fallback,
        fallbackNotice: `Used local rapid-beat matching (${msg.slice(0, 140)}).`,
      };
    }
  }

  const fallback = alignWithLocalHeuristic(
    cleanScript,
    input.audioDurationMs,
    input.pauses,
    input.images,
    targetBeatCount,
    pacingMode,
    cardTheme
  );

  if (wantsGemini && !isGeminiConfigured()) {
    return {
      ...fallback,
      fallbackNotice:
        'Gemini is not configured. Images are placed in numbered shot / upload order, NOT matched by visual content. Review the storyboard and make sure the narration script exactly matches the audio.',
    };
  }

  return {
    ...fallback,
    fallbackNotice:
      'Offline shot-order matching: Scene 1 uses the first numbered/uploaded image, scene 2 the next, etc. Visual contents were not analyzed; review scene assignments and ensure the audio matches the pasted script.',
  };
}

/**
 * Post-processes drafted scenes so no two consecutive cuts show the exact same static view:
 * converts reused media frames into tight focal sub-crops or $0 graphic stat/statement cards.
 */
function diversifyConsecutiveBeats(
  drafts: Array<SceneTimingDraft & { acousticStartMs?: number; acousticEndMs?: number }>,
  images: InternalMediaPayload[],
  pacingMode: PacingMode,
  cardTheme: GraphicCardTheme
): Array<SceneTimingDraft & { acousticStartMs?: number; acousticEndMs?: number }> {
  if (pacingMode === 'upload-match' || drafts.length <= 1) return drafts;

  const cropCycle: FocalCropRegion[] = [
    'left-focus',
    'right-focus',
    'tight-macro',
    'top-hero',
    'bottom-detail',
  ];
  let cropCursor = 0;
  let previousFinal: typeof drafts[number] | null = null;

  return drafts.map((draft, idx) => {
    const prev = previousFinal;
    let beatKind: BeatKind = draft.beatKind ?? 'media';
    let focalCrop: FocalCropRegion = draft.focalCrop ?? 'full';
    let graphicCard = draft.graphicCard;

    // 1. Auto-upgrade high-impact numeric clauses into Stat Counter cards (~max every 3rd beat)
    if (!graphicCard && beatKind !== 'graphic-card') {
      const numStat = extractNumericStat(draft.text);
      const isNotAdjacentCard = prev?.beatKind !== 'graphic-card';
      if (numStat && isNotAdjacentCard && (drafts.length > images.length || idx % 3 === 1)) {
        beatKind = 'graphic-card';
        graphicCard = {
          cardType: 'stat-counter',
          theme: cardTheme,
          headline: draft.text,
          statValue: numStat.statValue,
          statUnit: numStat.statUnit,
          kicker: draft.kicker,
        };
      }
    }

    // 2. If beats outnumber uploaded photos, interleave occasional bold statement / contrast cards (~20%)
    if (
      beatKind !== 'graphic-card' &&
      drafts.length > images.length &&
      idx >= 2 &&
      idx % 5 === 3 &&
      prev?.beatKind !== 'graphic-card'
    ) {
      const pair = detectContrastPair(draft.text, prev?.text);
      beatKind = 'graphic-card';
      graphicCard = pair
        ? {
            cardType: 'split-contrast',
            theme: cardTheme,
            headline: draft.text,
            leftLabel: pair.left,
            rightLabel: pair.right,
            kicker: draft.kicker,
          }
        : {
            cardType: 'statement',
            theme: cardTheme,
            headline: draft.text,
            kicker: draft.kicker,
          };
    }

    // 3. Avoid consecutive identical image+crop frames by turning repeats into punchy focal sub-crops
    if (beatKind !== 'graphic-card' && prev && prev.beatKind !== 'graphic-card' && prev.imageId === draft.imageId) {
      beatKind = 'crop-cut';
      let nextCrop = cropCycle[cropCursor % cropCycle.length];
      if (nextCrop === (prev.focalCrop ?? 'full')) {
        cropCursor++;
        nextCrop = cropCycle[cropCursor % cropCycle.length];
      }
      focalCrop = nextCrop;
      cropCursor++;
    }

    // Ensure motion is crisp & kinetic
    const kenBurnsDirection =
      prev && prev.kenBurnsDirection === draft.kenBurnsDirection
        ? sanitizeDirection(undefined, idx + 1, beatKind)
        : draft.kenBurnsDirection;

    const sfxCue =
      beatKind === 'graphic-card' && graphicCard?.cardType === 'stat-counter'
        ? 'cashtick'
        : beatKind === 'crop-cut' && draft.sfxCue === 'whoosh'
          ? 'shutter'
          : draft.sfxCue;

    const finalized = {
      ...draft,
      beatKind,
      focalCrop,
      graphicCard,
      kenBurnsDirection,
      sfxCue,
    };
    previousFinal = finalized;
    return finalized;
  });
}

async function alignWithGeminiMultimodal(
  client: NonNullable<ReturnType<typeof getGeminiClient>>,
  cleanScript: string,
  audioDurationMs: number,
  audioProxyPath: string | undefined,
  pauses: SpeechPause[],
  images: InternalMediaPayload[],
  targetBeatCount: number,
  pacingMode: PacingMode,
  cardTheme: GraphicCardTheme
): Promise<AlignScenesOutput> {
  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [];

  let hasAudioPart = false;
  if (audioProxyPath) {
    try {
      const audioStat = await fs.stat(audioProxyPath);
      if (audioStat.size > 0 && audioStat.size <= 14 * 1024 * 1024) {
        const audioBuf = await fs.readFile(audioProxyPath);
        parts.push({
          text: `VOICEOVER AUDIO TRACK (${(audioDurationMs / 1000).toFixed(3)}s total, ${audioDurationMs}ms). Listen closely to pinpoint exact spoken word startMs and endMs timestamps for every rapid visual beat:`,
        });
        parts.push({
          inlineData: {
            mimeType: 'audio/mp3',
            data: audioBuf.toString('base64'),
          },
        });
        hasAudioPart = true;
      }
    } catch {
      // Proceed with vision + pauses
    }
  }

  const visionMedia = images.slice(0, 36);
  for (const media of visionMedia) {
    const buffer = await fs.readFile(media.thumbPath);
    const kindLabel =
      media.mediaType === 'video'
        ? `VIDEO B-ROLL CLIP (${((media.clipDurationMs ?? 3000) / 1000).toFixed(1)}s)`
        : 'PHOTO';
    parts.push({
      text: `Media ID: "${media.id}" | Type: ${kindLabel} | Original Filename: "${media.originalName}" | Dimensions: ${media.width}x${media.height}`,
    });
    parts.push({
      inlineData: {
        mimeType: 'image/jpeg',
        data: buffer.toString('base64'),
      },
    });
  }

  const pauseSummary =
    pauses.length > 0
      ? pauses
          .slice(0, 40)
          .map((p) => `${p.midMs}ms (${p.durationMs}ms pause)`)
          .join(', ')
      : 'None detected (continuous narration)';

  const pacingRule =
    pacingMode === 'upload-match'
      ? `Break script into EXACTLY ${targetBeatCount} scenes matching the uploaded media count.`
      : `HYPER-DYNAMIC CONCEPT CUTTING: Break the voiceover script into ~${targetBeatCount} rapid visual micro-beats (each 1.0 to 2.0 seconds, only 2–6 words per beat!). Whenever the narrator changes noun or concept (for example: "cats" -> Beat 1, "and dogs" -> Beat 2; "200,000 followers" -> Beat 1, "in 8 days" -> Beat 2), CUT TO A NEW BEAT immediately!`;

  const promptText = `You are a master viral documentary & explainer reel editor cutting a high-retention video where visuals switch constantly as words change.

TASK:
1. Inspect EVERY uploaded media item above and write a 1-sentence visualSummary for each imageId.
2. ${pacingRule}
   - Preserve the EXACT original words and order of the script without translating, dropping, or altering words.
3. ${hasAudioPart ? 'LISTEN TO THE AUDIO TRACK ABOVE and give exact spoken startMs and endMs millisecond boundaries! Scene 1 starts at 0ms, scenes are contiguous (scene[i].endMs === scene[i+1].startMs), final scene ends at ' + audioDurationMs + 'ms.' : 'Estimate contiguous startMs and endMs synced to speech pauses.'}
4. Visual Diversity Rule (Hybrid Multiplier):
   - Match every spoken beat to the single best imageId based on ACTUAL VISUAL CONTENT.
   - If you have more beats than photos (${targetBeatCount} beats vs ${images.length} uploads), switch between:
     * beatKind: "media" (fresh uploaded visual)
     * beatKind: "crop-cut" (different camera focalCrop on a shared image: 'left-focus' | 'right-focus' | 'tight-macro' | 'top-hero' | 'bottom-detail')
     * beatKind: "graphic-card" (~20-30% of beats, especially numbers/stats like "200,000" or short high-punch statements — supply statValue/statUnit when numeric!)
5. For every beat assign:
   - emotionalWeight (0.8 to 1.55)
   - kenBurnsDirection ('snap-zoom-in' | 'whip-zoom' | 'pan-left' | 'pan-right' | 'impact-shake' | 'pan-up')
   - captionZone ('top-banner' | 'center-impact' | 'lower-hero')
   - kicker (1-2 uppercase words), accentPhrase (1-2 punch words verbatim from text)
   - sfxCue ('impact' | 'whoosh' | 'pop' | 'riser' | 'glitch' | 'chime' | 'typeclick' | 'thud' | 'shutter' | 'cashtick' | 'keyburst' | 'flashwhoosh').

AUDIO CONTEXT:
- Total Audio Duration: ${(audioDurationMs / 1000).toFixed(3)} seconds (${audioDurationMs}ms)
- Detected Pauses: ${pauseSummary}

VOICEOVER SCRIPT (preserve exact wording in order):
"""
${cleanScript}
"""`;

  parts.push({ text: promptText });

  const response = await client.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: { parts },
    config: {
      systemInstruction:
        'You are an ultra-responsive multimodal audio-visual micro-beat editor. Return strict JSON. Never hold a single static shot across multiple concepts—split contrasting nouns/numbers into separate contiguous 1-2s beats.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          imageDescriptions: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                imageId: { type: Type.STRING },
                visualSummary: { type: Type.STRING },
              },
              required: ['imageId', 'visualSummary'],
            },
          },
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                text: { type: Type.STRING },
                imageId: { type: Type.STRING },
                matchReason: { type: Type.STRING },
                emotionalWeight: { type: Type.NUMBER },
                kenBurnsDirection: { type: Type.STRING },
                beatKind: { type: Type.STRING },
                focalCrop: { type: Type.STRING },
                captionZone: { type: Type.STRING },
                statValue: { type: Type.STRING },
                statUnit: { type: Type.STRING },
                kicker: { type: Type.STRING },
                accentPhrase: { type: Type.STRING },
                sfxCue: { type: Type.STRING },
                startMs: { type: Type.INTEGER },
                endMs: { type: Type.INTEGER },
              },
              required: [
                'text',
                'imageId',
                'matchReason',
                'emotionalWeight',
                'kenBurnsDirection',
                'startMs',
                'endMs',
              ],
            },
          },
        },
        required: ['imageDescriptions', 'scenes'],
      },
    },
  });

  const rawJson = (response.text ?? '').trim();
  if (!rawJson) {
    throw new Error('Gemini returned an empty alignment payload.');
  }

  const parsed = JSON.parse(rawJson) as GeminiResponsePayload;
  const rawScenes = parsed.scenes ?? [];
  if (rawScenes.length === 0) {
    throw new Error('Gemini returned zero scenes.');
  }

  const validImageIds = new Set(images.map((img) => img.id));
  const imageSummaries: Record<string, string> = {};
  for (const desc of parsed.imageDescriptions ?? []) {
    if (desc.imageId && desc.visualSummary) {
      imageSummaries[desc.imageId] = desc.visualSummary.trim();
    }
  }
  for (const img of images) {
    if (!imageSummaries[img.id]) {
      imageSummaries[img.id] = `Uploaded ${img.mediaType} (${img.originalName}, ${img.width}×${img.height})`;
    }
  }

  const initialDrafts = rawScenes.map((s, idx) => {
    const safeImageId =
      s.imageId && validImageIds.has(s.imageId)
        ? s.imageId
        : images[idx % images.length].id;

    const weight =
      typeof s.emotionalWeight === 'number' && Number.isFinite(s.emotionalWeight)
        ? Math.max(0.75, Math.min(1.65, s.emotionalWeight))
        : 1.0;

    const text = (s.text ?? '').trim() || `Beat ${idx + 1}`;
    const accentPhrase = (s.accentPhrase ?? '').trim() || inferAccentPhrase(text);
    const beatKind: BeatKind =
      s.beatKind === 'graphic-card'
        ? 'graphic-card'
        : s.beatKind === 'crop-cut'
          ? 'crop-cut'
          : 'media';

    let graphicCard: GraphicCardData | undefined;
    if (beatKind === 'graphic-card') {
      const sv = (s.statValue ?? '').trim() || extractNumericStat(text)?.statValue || '';
      graphicCard = sv
        ? {
            cardType: 'stat-counter',
            theme: cardTheme,
            headline: text,
            statValue: sv,
            statUnit: (s.statUnit ?? '').trim() || extractNumericStat(text)?.statUnit,
            kicker: (s.kicker ?? '').trim().toUpperCase(),
          }
        : {
            cardType: 'statement',
            theme: cardTheme,
            headline: text,
            kicker: (s.kicker ?? '').trim().toUpperCase(),
          };
    }

    return {
      text,
      imageId: safeImageId,
      matchReason: (s.matchReason ?? '').trim() || 'Matched visually by Gemini Vision',
      emotionalWeight: weight,
      kenBurnsDirection: sanitizeDirection(s.kenBurnsDirection, idx, beatKind),
      beatKind,
      focalCrop: sanitizeFocalCrop(s.focalCrop, 'full'),
      graphicCard,
      captionZone: sanitizeCaptionZone(s.captionZone, text, idx),
      kicker: (s.kicker ?? '').trim().toUpperCase() || `BEAT ${String(idx + 1).padStart(2, '0')}`,
      accentPhrase,
      sfxCue: sanitizeSfxCue(s.sfxCue, text, idx, accentPhrase, beatKind),
      acousticStartMs: typeof s.startMs === 'number' ? s.startMs : undefined,
      acousticEndMs: typeof s.endMs === 'number' ? s.endMs : undefined,
    };
  });

  const normalizedDrafts = diversifyConsecutiveBeats(initialDrafts, images, pacingMode, cardTheme);

  const acousticScenes = hasAudioPart
    ? reconcileAcousticBoundaries(normalizedDrafts, audioDurationMs)
    : null;

  const timedScenes =
    acousticScenes ??
    computeDynamicSceneTimings(normalizedDrafts, audioDurationMs, pauses);

  return {
    scenes: timedScenes,
    imageSummaries,
    engineUsed: 'gemini-4-hydrogen',
  };
}

function reconcileAcousticBoundaries(
  drafts: Array<
    SceneTimingDraft & { acousticStartMs?: number; acousticEndMs?: number }
  >,
  audioDurationMs: number
): SceneItem[] | null {
  if (drafts.length === 0) return null;
  const minDur = Math.min(380, Math.floor(audioDurationMs / drafts.length));

  const cuts: number[] = [0];
  for (let i = 0; i < drafts.length - 1; i++) {
    const rawEnd = drafts[i].acousticEndMs ?? drafts[i + 1].acousticStartMs;
    if (typeof rawEnd !== 'number' || !Number.isFinite(rawEnd)) {
      return null;
    }
    const prev = cuts[cuts.length - 1];
    const remainingMin = (drafts.length - 1 - i) * minDur;
    const clampedEnd = Math.round(
      Math.max(prev + minDur, Math.min(audioDurationMs - remainingMin, rawEnd))
    );
    cuts.push(clampedEnd);
  }
  cuts.push(Math.round(audioDurationMs));

  return drafts.map((draft, idx) => {
    const startMs = cuts[idx];
    const endMs = cuts[idx + 1];
    return {
      id: draft.id ?? `scene_${idx + 1}`,
      index: idx,
      text: draft.text,
      startMs,
      endMs,
      durationMs: Math.max(100, endMs - startMs),
      imageId: draft.imageId,
      matchReason: draft.matchReason,
      emotionalWeight: draft.emotionalWeight,
      kenBurnsDirection: draft.kenBurnsDirection,
      snappedToPause: false,
      alignmentSource: 'voice-locked',
      beatKind: draft.beatKind,
      focalCrop: draft.focalCrop,
      graphicCard: draft.graphicCard,
      captionZone: draft.captionZone,
      kicker: draft.kicker,
      accentPhrase: draft.accentPhrase,
      sfxCue: draft.sfxCue,
      imagePrompt: draft.imagePrompt,
    };
  });
}

const DISCOURSE_CONNECTORS = new Set([
  'aur',
  'lekin',
  'magar',
  'phir',
  'kyunke',
  'kyunki',
  'jab',
  'tab',
  'isliye',
  'isiliye',
  'aakhir',
  'toh',
  'ya',
  'and',
  'or',
  'vs',
  'versus',
  'but',
  'then',
  'because',
  'while',
  'when',
  'so',
  'after',
  'before',
  'without',
  'with',
  'no',
  'not',
  'into',
  'just',
  'however',
  'suddenly',
]);

const ROMAN_URDU_CONCEPT_MAP: Record<string, string[]> = {
  hans: ['laugh', 'laughing', 'smile', 'happy', 'villagers', 'people', 'crowd'],
  hansi: ['laugh', 'laughing', 'smile', 'happy'],
  gaon: ['village', 'villagers', 'rural', 'courtyard', 'chai', 'tea'],
  log: ['people', 'villagers', 'crowd', 'group'],
  views: ['analytics', 'chart', 'dashboard', 'laptop', 'screen', 'zero'],
  zero: ['zero', 'analytics', 'empty', 'flat', 'laptop'],
  analytics: ['analytics', 'dashboard', 'chart', 'laptop', 'screen'],
  laptop: ['laptop', 'computer', 'screen', 'desk', 'analytics'],
  likha: ['notebook', 'write', 'script', 'desk', 'pen'],
  script: ['notebook', 'script', 'mic', 'desk', 'microphone'],
  mic: ['mic', 'microphone', 'studio', 'desk', 'notebook'],
  kahani: ['story', 'notebook', 'script', 'villagers'],
  pahad: ['mountain', 'ridge', 'valley', 'sunrise', 'traveler'],
  pahadon: ['mountain', 'ridge', 'valley', 'sunrise'],
  suraj: ['sunrise', 'sun', 'golden', 'morning', 'mountain'],
  subah: ['morning', 'dawn', 'sunrise', 'window'],
  safar: ['journey', 'traveler', 'mountain', 'road', 'ridge'],
  billi: ['cat', 'cats', 'kitten'],
  kutta: ['dog', 'dogs', 'puppy'],
  kutte: ['dog', 'dogs', 'puppy'],
  paisa: ['money', 'cash', 'gold', 'wealth', 'coins'],
  paise: ['money', 'cash', 'gold', 'wealth', 'coins'],
};

/**
 * Splits a voiceover script cleanly into concept micro-beats (including paired nouns
 * like "cats" | "and dogs" and numeric clauses) up to targetCount.
 */
export function smartTokenizeScript(rawScript: string, targetCount: number): string[] {
  const cleaned = rawScript.replace(/\s+/g, ' ').trim();
  const safeTarget = Math.max(1, targetCount);

  let clauses = cleaned
    .split(/(?<=[.!?۔|])\s+/)
    .map((c) => c.trim())
    .filter(Boolean);

  if (clauses.length < safeTarget) {
    clauses = clauses.flatMap((c) =>
      c
        .split(/(?<=[,;،:])\s+/)
        .map((sub) => sub.trim())
        .filter(Boolean)
    );
  }

  // Split paired nouns / concept connectors proactively when short enough to give rapid switches
  if (clauses.length < safeTarget) {
    clauses = clauses.flatMap((c) => {
      const words = c.split(/\s+/);
      if (words.length < 4) return [c];
      return c
        .split(/\s+(?=(?:and|or|vs|versus|but|then|without|aur|lekin|magar|phir)\s+)/i)
        .map((p) => p.trim())
        .filter(Boolean);
    });
  }

  while (clauses.length < safeTarget) {
    let longestIdx = 0;
    let longestWordCount = 0;
    for (let i = 0; i < clauses.length; i++) {
      const wc = clauses[i].split(/\s+/).length;
      if (wc > longestWordCount) {
        longestWordCount = wc;
        longestIdx = i;
      }
    }

    if (longestWordCount < 3) {
      break;
    }

    const words = clauses[longestIdx].split(/\s+/);
    const mid = Math.floor(words.length / 2);
    let splitAt = mid;

    for (let offset = 0; offset <= Math.floor(words.length * 0.35); offset++) {
      const right = mid + offset;
      const left = mid - offset;
      if (right >= 1 && right < words.length) {
        const w = words[right].toLowerCase().replace(/[^a-z]/g, '');
        if (DISCOURSE_CONNECTORS.has(w) || /\d/.test(words[right])) {
          splitAt = right;
          break;
        }
      }
      if (left >= 1 && left < words.length) {
        const w = words[left].toLowerCase().replace(/[^a-z]/g, '');
        if (DISCOURSE_CONNECTORS.has(w) || /\d/.test(words[left])) {
          splitAt = left;
          break;
        }
      }
    }

    splitAt = Math.max(1, Math.min(words.length - 1, splitAt));
    const firstHalf = words.slice(0, splitAt).join(' ').trim();
    const secondHalf = words.slice(splitAt).join(' ').trim();
    if (!firstHalf || !secondHalf) break;

    clauses.splice(longestIdx, 1, firstHalf, secondHalf);
  }

  while (clauses.length > safeTarget && clauses.length > 1) {
    let minPairIdx = 0;
    let minPairWords = Infinity;
    for (let i = 0; i < clauses.length - 1; i++) {
      const combined =
        clauses[i].split(/\s+/).length + clauses[i + 1].split(/\s+/).length;
      if (combined < minPairWords) {
        minPairWords = combined;
        minPairIdx = i;
      }
    }
    const merged = `${clauses[minPairIdx]} ${clauses[minPairIdx + 1]}`.trim();
    clauses.splice(minPairIdx, 2, merged);
  }

  return clauses;
}

function alignWithLocalHeuristic(
  cleanScript: string,
  audioDurationMs: number,
  pauses: SpeechPause[],
  images: InternalMediaPayload[],
  targetBeatCount: number,
  pacingMode: PacingMode,
  cardTheme: GraphicCardTheme
): AlignScenesOutput {
  const clauses = smartTokenizeScript(cleanScript, targetBeatCount);
  const orderedImages = orderMediaByShotNumber(images);
  const imageSummaries: Record<string, string> = {};

  for (const img of images) {
    const readableName = img.originalName
      .replace(/\.[^.]+$/, '')
      .replace(/[_-]+/g, ' ');
    imageSummaries[img.id] =
      img.mediaType === 'video'
        ? `B-roll clip "${readableName}" (${((img.clipDurationMs ?? 3000) / 1000).toFixed(1)}s, ${img.width}×${img.height})`
        : `Uploaded photo "${readableName}" (${img.width}×${img.height})`;
  }

  const rawDrafts: SceneTimingDraft[] = clauses.map((clause, idx) => {
    const tokens = clause
      .toLowerCase()
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9]/g, ''))
      .filter(Boolean);

    // Offline mode has no computer vision. Preserve the intended shot sequence;
    // filename keyword scoring often assigned the wrong crow, pot, and action.
    const bestImg = selectMediaForBeat(orderedImages, idx, clauses.length);

    let emotionalWeight = 1.0;
    if (/[!?]/.test(clause) || /\d/.test(clause)) emotionalWeight = 1.2;
    else if (tokens.length >= 7) emotionalWeight = 1.1;
    else if (tokens.length <= 3) emotionalWeight = 0.88;

    const accentPhrase = inferAccentPhrase(clause);

    return {
      text: clause,
      imageId: bestImg.id,
      matchReason: `Offline shot order ${orderedImages.indexOf(bestImg) + 1}/${orderedImages.length}: ${bestImg.originalName} (not visual AI matching)`,
      emotionalWeight,
      kenBurnsDirection: sanitizeDirection(undefined, idx, 'media'),
      beatKind: 'media',
      focalCrop: 'full',
      captionZone: sanitizeCaptionZone(undefined, clause, idx),
      kicker: idx === 0 ? 'THE HOOK' : `BEAT ${String(idx + 1).padStart(2, '0')}`,
      accentPhrase,
      sfxCue: inferDefaultSfxCue(clause, idx, accentPhrase, 'media'),
    };
  });

  const diversified = diversifyConsecutiveBeats(rawDrafts, images, pacingMode, cardTheme);
  const scenes = computeDynamicSceneTimings(diversified, audioDurationMs, pauses);
  return {
    scenes,
    imageSummaries,
    engineUsed: 'local-heuristic',
  };
}

export interface SceneTimingDraft {
  id?: string;
  text: string;
  imageId: string;
  matchReason: string;
  emotionalWeight: number;
  kenBurnsDirection: KenBurnsDirection;
  alignmentSource?: AlignmentSource;
  beatKind?: BeatKind;
  focalCrop?: FocalCropRegion;
  graphicCard?: GraphicCardData;
  captionZone?: CaptionZone;
  kicker?: string;
  accentPhrase?: string;
  sfxCue?: SfxCueType;
  imagePrompt?: string;
}

export function computeDynamicSceneTimings(
  drafts: SceneTimingDraft[],
  audioDurationMs: number,
  pauses: SpeechPause[]
): SceneItem[] {
  const count = drafts.length;
  if (count === 0) return [];

  const totalMs = Math.max(200, Math.round(audioDurationMs));
  const minSceneMs = Math.min(480, Math.floor(totalMs / count));

  const weights = drafts.map((d) => {
    const wordCount = Math.max(1.5, d.text.trim().split(/\s+/).length);
    const ew = Math.max(0.75, Math.min(1.65, d.emotionalWeight || 1.0));
    return wordCount * ew;
  });
  const totalWeight = weights.reduce((acc, w) => acc + w, 0) || count;

  const rawDurations = weights.map((w) =>
    Math.max(minSceneMs, Math.round((w / totalWeight) * totalMs))
  );

  const currentSum = rawDurations.reduce((a, b) => a + b, 0);
  const scaleFactor = totalMs / currentSum;
  const durations = rawDurations.map((d) => Math.max(minSceneMs, Math.round(d * scaleFactor)));

  const diff = totalMs - durations.reduce((a, b) => a + b, 0);
  if (diff !== 0) {
    let adjustIdx = 0;
    for (let i = 1; i < durations.length; i++) {
      if (durations[i] > durations[adjustIdx]) adjustIdx = i;
    }
    durations[adjustIdx] = Math.max(200, durations[adjustIdx] + diff);
  }

  const boundaries: number[] = [0];
  let running = 0;
  for (let i = 0; i < count - 1; i++) {
    running += durations[i];
    boundaries.push(running);
  }
  boundaries.push(totalMs);

  const snappedFlags = new Array<boolean>(count).fill(false);
  const usedPauses = new Set<number>();

  for (let b = 1; b < count; b++) {
    const targetMs = boundaries[b];
    const minAllowed = boundaries[b - 1] + minSceneMs;
    const maxAllowed = boundaries[b + 1] - minSceneMs;

    let bestPauseIdx = -1;
    let bestDist = 360;

    for (let p = 0; p < pauses.length; p++) {
      if (usedPauses.has(p)) continue;
      const pauseMid = pauses[p].midMs;
      if (pauseMid >= minAllowed && pauseMid <= maxAllowed) {
        const dist = Math.abs(pauseMid - targetMs);
        if (dist < bestDist) {
          bestDist = dist;
          bestPauseIdx = p;
        }
      }
    }

    if (bestPauseIdx !== -1) {
      boundaries[b] = pauses[bestPauseIdx].midMs;
      usedPauses.add(bestPauseIdx);
      snappedFlags[b - 1] = true;
    }
  }

  return drafts.map((draft, idx) => {
    const startMs = boundaries[idx];
    const endMs = idx === count - 1 ? totalMs : boundaries[idx + 1];
    const durationMs = Math.max(100, endMs - startMs);
    const snapped = snappedFlags[idx] ?? false;
    return {
      id: draft.id ?? `scene_${idx + 1}`,
      index: idx,
      text: draft.text,
      startMs,
      endMs,
      durationMs,
      imageId: draft.imageId,
      matchReason: draft.matchReason,
      emotionalWeight: draft.emotionalWeight,
      kenBurnsDirection: draft.kenBurnsDirection,
      snappedToPause: snapped,
      alignmentSource: snapped ? 'pause-snapped' : 'estimated',
      beatKind: draft.beatKind,
      focalCrop: draft.focalCrop,
      graphicCard: draft.graphicCard,
      captionZone: draft.captionZone,
      kicker: draft.kicker,
      accentPhrase: draft.accentPhrase,
      sfxCue: draft.sfxCue,
      imagePrompt: draft.imagePrompt,
    };
  });
}

export function serializeImagesWithSummaries(
  images: Array<
    InternalMediaPayload & {
      url: string;
      thumbUrl: string;
    }
  >,
  summaries: Record<string, string>
): UploadedImage[] {
  return images.map((img) => ({
    id: img.id,
    originalName: img.originalName,
    mediaType: img.mediaType,
    clipDurationMs: img.clipDurationMs,
    url: img.url,
    thumbUrl: img.thumbUrl,
    width: img.width,
    height: img.height,
    visualSummary: summaries[img.id] ?? `Uploaded ${img.mediaType} (${img.originalName})`,
  }));
}
