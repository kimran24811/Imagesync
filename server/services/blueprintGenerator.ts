import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { Type } from '@google/genai';
import type {
  ArtStylePresetId,
  AspectRatio,
  BeatKind,
  BlueprintScene,
  GraphicCardData,
  GraphicCardTheme,
  SfxCueType,
  StoryBlueprint,
  TtsVoiceName,
} from '../../src/types/studio.ts';
import { inferDefaultSfxCue } from '../../src/utils/sfxSchedule.ts';
import { getGeminiClient, isGeminiConfigured } from './geminiClient.ts';

export interface ArtStylePresetDefinition {
  id: ArtStylePresetId;
  categoryLabel: string;
  label: string;
  tagline: string;
  swatches: [string, string, string];
  characterAnchor: string;
  masterStyleAnchor: string;
  continuityPrefix: string;
}

export const ART_STYLE_PRESETS: ArtStylePresetDefinition[] = [
  {
    id: 'saveo-ink',
    categoryLabel: 'Character Explainer',
    label: 'Saveo Dark Ink Character',
    tagline: 'Minimalist round-head character in dark hoodie, crisp ink lines, selective rim lighting',
    swatches: ['#18181B', '#E4E4E7', '#F43F5E'],
    characterAnchor:
      'Consistent recurring protagonist: stylized minimalist round-headed character with expressive simple dot eyes, wearing an oversized charcoal-grey zip hoodie, black backwards baseball cap, slim dark pants, and clean white sneakers. Identical head-to-body proportions in every shot.',
    masterStyleAnchor:
      '2D dark graphic-novel illustration, bold crisp ink outlines, muted monochromatic charcoal room tones paired with one subtle warm practical or coral rim light, atmospheric vignette shadows, clean uncluttered background composition, zero text or letters inside the image.',
    continuityPrefix:
      'Use the EXACT same character design, proportions, hoodie, backwards cap, ink line thickness, and moody dark graphic-novel lighting as the previously generated reference image.',
  },
  {
    id: 'stick-figure',
    categoryLabel: 'Stick Art',
    label: 'Stick Art / Kinetic Chalkboard',
    tagline: 'Expressive minimalist stick-figure storytelling on dark matte slate with glowing accents',
    swatches: ['#09090B', '#F8FAFC', '#38BDF8'],
    characterAnchor:
      'Consistent recurring stick-figure protagonist: clean geometric white-chalk/ink stick figure with a smooth circular head, expressive angled eyebrows or minimal pose silhouettes, and subtle cyan/coral highlight props.',
    masterStyleAnchor:
      'Minimalist dark chalkboard stick-art illustration, deep charcoal matte canvas (#0E1117), crisp bright hand-drawn chalk-white line art accented with selective glowing electric cyan or coral highlights, dynamic action poses and visual metaphors, zero embedded text inside the image.',
    continuityPrefix:
      'Keep the EXACT same stick-figure line thickness, head circle proportions, dark slate background texture, and selective cyan/coral glow palette as the reference image.',
  },
  {
    id: 'whiteboard-sketch',
    categoryLabel: 'Whiteboard Explainer',
    label: 'Whiteboard Marker Sketch',
    tagline: 'Crisp black dry-erase ink drawings on clean white paper with blue & red marker accents',
    swatches: ['#FFFFFF', '#0F172A', '#2563EB'],
    characterAnchor:
      'Consistent recurring presenter/character drawn in clean black fine-liner dry-erase marker strokes with simple expressive cartoon proportions.',
    masterStyleAnchor:
      'Clean whiteboard explainer illustration on crisp off-white paper texture, smooth bold black marker ink outlines, selective cobalt-blue and coral-red marker shading highlights, generous clean whitespace, zero written text labels inside the drawing.',
    continuityPrefix:
      'Maintain the EXACT same black marker stroke weight, clean white paper backdrop, character face, and blue/red marker accent style as the reference sketch.',
  },
  {
    id: 'noir-gold',
    categoryLabel: 'Finance & History',
    label: 'Noir Monochrome + Gold',
    tagline: 'High-contrast charcoal ink noir with glowing molten gold highlights (Gold Rush style)',
    swatches: ['#0B0F19', '#94A3B8', '#F59E0B'],
    characterAnchor:
      'Consistent recurring protagonist: sharp-featured strategist in a dark tailored coat, crisp monochrome chiaroscuro shading, recognizable silhouette across every frame.',
    masterStyleAnchor:
      'High-contrast dark noir ink & etched engraving illustration, deep obsidian shadows, stark grayscale ink shading accented ONLY with selective luminous molten gold highlights and warm amber rim glow, dramatic low-angle framing, zero text or watermarks inside the image.',
    continuityPrefix:
      'Keep the EXACT same protagonist face, coat, ink etching texture, monochrome palette, and selective glowing gold accent lighting as the reference image.',
  },
  {
    id: 'documentary-35mm',
    categoryLabel: 'Documentary Film',
    label: 'Documentary 35mm Cinema',
    tagline: 'Moody 35mm photorealistic shadows, tungsten practical lights, subtle film grain',
    swatches: ['#0F172A', '#38BDF8', '#FDBA74'],
    characterAnchor:
      'Consistent recurring subject: grounded real-world creator or founder in dark minimalist knitwear, shot consistently in 35mm medium-wide cinematic framing.',
    masterStyleAnchor:
      'Photorealistic 35mm documentary still frame, shallow depth of field, moody tungsten practical key light against deep slate-teal shadows, subtle organic 35mm film grain, rich contrast, zero embedded text or logos.',
    continuityPrefix:
      'Match the EXACT same person, wardrobe, 35mm lens depth of field, and tungsten-on-slate color grade as the reference frame.',
  },
  {
    id: 'editorial-cream',
    categoryLabel: 'Editorial Infographics',
    label: 'Editorial Cream Poster',
    tagline: 'Warm cream paper card aesthetic with crisp charcoal ink & selective coral highlights',
    swatches: ['#F5F0E6', '#1E293B', '#F43F5E'],
    characterAnchor:
      'Consistent recurring minimalist character drawn in crisp matte charcoal ink strokes with clean geometric Swiss poster proportions.',
    masterStyleAnchor:
      'Minimalist Swiss editorial explainer illustration on warm cream paper (#F5F0E6), crisp clean charcoal ink linework, subtle paper grain, selective coral-red (#F43F5E) accent details, generous negative space, zero text inside the illustration.',
    continuityPrefix:
      'Maintain the EXACT same warm cream paper background, charcoal ink stroke weight, and selective coral accent palette as the reference illustration.',
  },
  {
    id: 'midnight-crimson',
    categoryLabel: 'Horror & Mystery',
    label: 'Midnight Thriller & Mystery',
    tagline: 'Eerie foggy silhouettes, cold moonlight, subtle crimson accents, suspense framing',
    swatches: ['#09090B', '#475569', '#DC2626'],
    characterAnchor:
      'Consistent recurring lone investigator silhouette in a long dark trench coat bathed in cold pale moonlight rim light.',
    masterStyleAnchor:
      'Atmospheric dark thriller & mystery illustration, dense midnight mist, deep slate-blue shadows illuminated by cold silver moonlight and a single tense crimson accent glow, unsettling wide cinematic perspective, zero text in image.',
    continuityPrefix:
      'Keep the EXACT same lone trench-coat silhouette, cold moonlight palette, dense atmospheric mist, and subtle crimson accent glow as the reference image.',
  },
  {
    id: 'stylized-3d',
    categoryLabel: '3D Animation',
    label: 'Stylized 3D Matte Diorama',
    tagline: 'Tactile matte miniature 3D character & studio lighting with shallow depth of field',
    swatches: ['#1E1B4B', '#A5B4FC', '#F472B6'],
    characterAnchor:
      'Consistent recurring stylized 3D matte-clay character with clean rounded geometry, subtle fabric texture hoodie, and soft expressive eyes.',
    masterStyleAnchor:
      'Stylized matte 3D diorama render, soft studio rim lighting on dark atmospheric background, subtle tilt-shift shallow depth of field, tactile miniature clay & fabric materials, high-contrast color separation, zero embedded text.',
    continuityPrefix:
      'Preserve the EXACT same 3D character sculpt, matte clay material finish, outfit, and miniature studio rim lighting as the reference render.',
  },
];

export function getArtStylePreset(
  presetId: ArtStylePresetId,
  customStyleNote?: string
): ArtStylePresetDefinition {
  if (presetId === 'custom') {
    const note =
      (customStyleNote ?? '').trim() ||
      'Consistent minimalist dark cinematic illustration with clean bold outlines and moody dramatic lighting, zero text inside image.';
    return {
      id: 'custom',
      categoryLabel: 'Custom Style',
      label: 'Custom Locked Style',
      tagline: note.slice(0, 90),
      swatches: ['#1E293B', '#64748B', '#10B981'],
      characterAnchor: `Consistent recurring protagonist matching this exact custom style: ${note}`,
      masterStyleAnchor: `${note}. Maintain strict visual consistency across every shot, clean framing, zero text or watermarks in the image.`,
      continuityPrefix:
        'Keep the EXACT same character design, color palette, line style, and lighting as the reference image.',
    };
  }
  return ART_STYLE_PRESETS.find((p) => p.id === presetId) ?? ART_STYLE_PRESETS[0];
}

function defaultCardThemeForPreset(presetId: ArtStylePresetId): GraphicCardTheme {
  if (presetId === 'editorial-cream' || presetId === 'whiteboard-sketch') return 'cream-poster';
  if (presetId === 'noir-gold') return 'noir-gold';
  return 'obsidian';
}

export interface GenerateBlueprintInput {
  topic: string;
  language: string;
  sceneCount: number | 'auto';
  aspectRatio: AspectRatio;
  artStyleId: ArtStylePresetId;
  customStyleNote?: string;
}

interface GeminiBlueprintResponse {
  characterAnchor?: string;
  masterStyleAnchor?: string;
  scenes?: Array<{
    title?: string;
    spokenLine?: string;
    kicker?: string;
    accentPhrase?: string;
    sfxCue?: string;
    beatKind?: string;
    statValue?: string;
    statUnit?: string;
    visualAction?: string;
    imagePrompt?: string;
  }>;
}

const VALID_SFX: Set<SfxCueType> = new Set([
  'none',
  'impact',
  'whoosh',
  'pop',
  'riser',
  'glitch',
  'chime',
  'typeclick',
  'thud',
  'shutter',
  'cashtick',
  'keyburst',
  'flashwhoosh',
]);

function sanitizeSfxCue(
  cue: string | undefined,
  text: string,
  idx: number,
  accentPhrase?: string,
  beatKind?: BeatKind
): SfxCueType {
  if (cue && VALID_SFX.has(cue as SfxCueType)) {
    return cue as SfxCueType;
  }
  return inferDefaultSfxCue(text, idx, accentPhrase, beatKind);
}

export async function generateStoryBlueprint(
  input: GenerateBlueprintInput
): Promise<StoryBlueprint> {
  const topic = input.topic.trim();
  if (!topic) {
    throw new Error('Please enter a video topic or story idea first.');
  }

  const targetCount =
    input.sceneCount === 'auto'
      ? 0
      : Math.max(4, Math.min(60, Math.round(Number(input.sceneCount) || 18)));

  const preset = getArtStylePreset(input.artStyleId, input.customStyleNote);
  const aspectHint =
    input.aspectRatio === '9:16'
      ? 'Vertical 9:16 portrait composition with clean negative space in the upper 25% for kinetic headline typography.'
      : 'Widescreen 16:9 cinematic composition with clean headroom for kinetic typography.';

  const client = getGeminiClient();
  if (client) {
    try {
      const firstBatchTarget = targetCount === 0 ? 18 : Math.min(20, targetCount);
      const countInstruction =
        targetCount === 0
          ? 'Determine natural rapid-cut micro-beat pacing (between 16 and 24 short 1-to-2 second visual beats total). Every new noun, contrast, or statistic gets its own beat.'
          : targetCount > 20
            ? `Generate Beats 1 to ${firstBatchTarget} of a fast ${targetCount}-beat visual story arc (leave room for continuation).`
            : `Generate EXACTLY ${firstBatchTarget} rapid sequential 1-2s micro-beats covering the complete story from hook to payoff.`;

      const firstBatch = await requestBlueprintBatch(
        client,
        topic,
        input.language,
        countInstruction,
        aspectHint,
        preset
      );

      let characterAnchor = firstBatch.characterAnchor;
      let masterStyleAnchor = firstBatch.masterStyleAnchor;
      const allScenes: BlueprintScene[] = [...firstBatch.scenes];

      if (targetCount > 20) {
        while (allScenes.length < targetCount) {
          const remaining = targetCount - allScenes.length;
          const batchSize = Math.min(20, remaining);
          const startNum = allScenes.length + 1;
          const endNum = allScenes.length + batchSize;
          const prevSummary = allScenes
            .slice(-5)
            .map((s) => `Beat ${s.index + 1}: ${s.spokenLine}`)
            .join('\n');

          const nextBatch = await requestBlueprintBatch(
            client,
            topic,
            input.language,
            `Continue the EXACT same rapid micro-beat story cleanly for Beats ${startNum} to ${endNum} out of ${targetCount} total beats. Generate EXACTLY ${batchSize} new micro-beats.\nPREVIOUS BEATS:\n${prevSummary}`,
            aspectHint,
            {
              ...preset,
              characterAnchor,
              masterStyleAnchor,
            },
            startNum - 1
          );

          characterAnchor = nextBatch.characterAnchor || characterAnchor;
          masterStyleAnchor = nextBatch.masterStyleAnchor || masterStyleAnchor;
          allScenes.push(...nextBatch.scenes.slice(0, remaining));
          if (nextBatch.scenes.length === 0) break;
        }
      }

      const finalScenes =
        targetCount > 0 ? allScenes.slice(0, targetCount) : allScenes;

      return {
        id: `bp_${crypto.randomBytes(4).toString('hex')}`,
        topic,
        language: input.language,
        artStyleId: preset.id,
        artStyleLabel: preset.label,
        categoryLabel: preset.categoryLabel,
        characterAnchor,
        masterStyleAnchor,
        continuityPrefix: preset.continuityPrefix,
        fullScript: finalScenes.map((s) => s.spokenLine).join(' '),
        scenes: finalScenes.map((s, idx) => ({ ...s, index: idx })),
        engineUsed: 'gemini-4-hydrogen',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Gemini request failed';
      return buildLocalFallbackBlueprint(
        topic,
        input.language,
        targetCount === 0 ? 18 : targetCount,
        aspectHint,
        preset,
        `Used structured rapid micro-beat template (${msg.slice(0, 120)}).`
      );
    }
  }

  const notice = !isGeminiConfigured()
    ? 'GEMINI_API_KEY is not configured; generated a structured rapid micro-beat blueprint template you can customize freely.'
    : undefined;

  return buildLocalFallbackBlueprint(
    topic,
    input.language,
    targetCount === 0 ? 18 : targetCount,
    aspectHint,
    preset,
    notice
  );
}

async function requestBlueprintBatch(
  client: NonNullable<ReturnType<typeof getGeminiClient>>,
  topic: string,
  language: string,
  countInstruction: string,
  aspectHint: string,
  preset: ArtStylePresetDefinition,
  startIndexOffset = 0
): Promise<{
  characterAnchor: string;
  masterStyleAnchor: string;
  scenes: BlueprintScene[];
}> {
  const prompt = `You are an elite viral short-form documentary & explainer editor (like high-retention monochrome/dark-ink reels where visuals switch EVERY 1 to 2 seconds!).

TOPIC: "${topic}"
SPOKEN LANGUAGE: ${language}
MICRO-BEAT PACING: ${countInstruction}
TARGET ASPECT RATIO: ${aspectHint}
CATEGORY & ART STYLE: ${preset.categoryLabel} — "${preset.label}"
BASE CHARACTER ANCHOR: ${preset.characterAnchor}
BASE STYLE ANCHOR: ${preset.masterStyleAnchor}

CRITICAL MICRO-BEAT RULES:
1. Cut visuals rapidly: EVERY beat spokenLine should be SHORT (2 to 6 words max, 1–2 seconds of speech!). Split contrasting concepts into separate beats ("cats" -> beat 1, "and dogs" -> beat 2; "200,000 followers" -> beat 1, "in 8 days" -> beat 2).
2. Lock characterAnchor and masterStyleAnchor so EVERY AI illustration beat shares identical character traits & lighting ("One character, every shot").
3. Mix beatKind intelligently so the user creates a super-dynamic reel with half the image generation burden:
   - Use beatKind: "media" (~70% of beats) for bespoke AI illustrations with an exact single-concept imagePrompt.
   - Use beatKind: "graphic-card" (~25–30% of beats) whenever a beat has a big number/stat ("200,000", "32M", "8 days") OR short punchy statement ("No team.", "Just one laptop.")—SceneSync auto-renders those at $0 cost!
4. For EVERY micro-beat provide:
   - title: 2-3 word beat title
   - spokenLine: ultra-crisp 2-6 words in ${language} (NO stage directions or asterisks)
   - kicker: short uppercase tag (2 words max, e.g. "THE HOOK", "FACT 01", "THE SHIFT")
   - accentPhrase: 1-2 power words or numbers extracted verbatim from spokenLine for oversized color pop
   - sfxCue: ('impact' | 'whoosh' | 'pop' | 'riser' | 'glitch' | 'chime' | 'typeclick' | 'thud' | 'shutter' | 'cashtick' | 'keyburst' | 'flashwhoosh')
   - beatKind: 'media' or 'graphic-card'
   - statValue: if beat contains a number/stat, extract it cleanly (e.g. "200,000" or "8 DAYS"), otherwise ""
   - statUnit: short label under the stat if statValue is present (e.g. "FOLLOWERS"), otherwise ""
   - visualAction: concrete single-subject visual action or card layout
   - imagePrompt: if beatKind is 'media', full copy-paste prompt embedding characterAnchor + masterStyleAnchor + single-subject visualAction + "${aspectHint}". Never put text overlays inside imagePrompt.`;

  const response = await client.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    config: {
      systemInstruction:
        'Return strict JSON matching the schema. Write very short rapid 2-6 word spokenLine micro-beats so visuals change every 1-2 seconds.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          characterAnchor: { type: Type.STRING },
          masterStyleAnchor: { type: Type.STRING },
          scenes: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING },
                spokenLine: { type: Type.STRING },
                kicker: { type: Type.STRING },
                accentPhrase: { type: Type.STRING },
                sfxCue: { type: Type.STRING },
                beatKind: { type: Type.STRING },
                statValue: { type: Type.STRING },
                statUnit: { type: Type.STRING },
                visualAction: { type: Type.STRING },
                imagePrompt: { type: Type.STRING },
              },
              required: [
                'title',
                'spokenLine',
                'kicker',
                'accentPhrase',
                'sfxCue',
                'beatKind',
                'visualAction',
                'imagePrompt',
              ],
            },
          },
        },
        required: ['characterAnchor', 'masterStyleAnchor', 'scenes'],
      },
    },
  });

  const raw = (response.text ?? '').trim();
  if (!raw) throw new Error('Gemini returned an empty blueprint.');
  const parsed = JSON.parse(raw) as GeminiBlueprintResponse;
  const rawScenes = parsed.scenes ?? [];
  if (rawScenes.length === 0) throw new Error('Gemini returned zero scenes.');

  const characterAnchor = (parsed.characterAnchor ?? '').trim() || preset.characterAnchor;
  const masterStyleAnchor = (parsed.masterStyleAnchor ?? '').trim() || preset.masterStyleAnchor;
  const cardTheme = defaultCardThemeForPreset(preset.id);

  const scenes: BlueprintScene[] = rawScenes.map((s, idx) => {
    const absIdx = startIndexOffset + idx;
    const spokenLine = (s.spokenLine ?? '').trim() || `Beat ${absIdx + 1} of ${topic}.`;
    const accentPhrase = (s.accentPhrase ?? '').trim();
    const beatKind: BeatKind =
      s.beatKind === 'graphic-card' ? 'graphic-card' : 'media';

    let graphicCard: GraphicCardData | undefined;
    if (beatKind === 'graphic-card') {
      const sv = (s.statValue ?? '').trim();
      graphicCard = sv
        ? {
            cardType: 'stat-counter',
            theme: cardTheme,
            headline: spokenLine,
            statValue: sv,
            statUnit: (s.statUnit ?? '').trim() || undefined,
            kicker: (s.kicker ?? '').trim().toUpperCase(),
          }
        : {
            cardType: 'statement',
            theme: cardTheme,
            headline: spokenLine,
            kicker: (s.kicker ?? '').trim().toUpperCase(),
          };
    }

    return {
      index: absIdx,
      title: (s.title ?? '').trim() || `Beat ${absIdx + 1}`,
      spokenLine,
      kicker:
        (s.kicker ?? '').trim().toUpperCase() || `BEAT ${String(absIdx + 1).padStart(2, '0')}`,
      accentPhrase,
      sfxCue: sanitizeSfxCue(s.sfxCue, spokenLine, absIdx, accentPhrase, beatKind),
      beatKind,
      graphicCard,
      visualAction: (s.visualAction ?? '').trim() || 'Protagonist shown in tight dynamic composition.',
      imagePrompt:
        (s.imagePrompt ?? '').trim() || `${characterAnchor} ${masterStyleAnchor} ${aspectHint}`,
    };
  });

  return { characterAnchor, masterStyleAnchor, scenes };
}

function buildLocalFallbackBlueprint(
  topic: string,
  language: string,
  sceneCount: number,
  aspectHint: string,
  preset: ArtStylePresetDefinition,
  fallbackNotice?: string
): StoryBlueprint {
  const cardTheme = defaultCardThemeForPreset(preset.id);
  const templates: Array<{
    title: string;
    kicker: string;
    spokenLine: string;
    accentPhrase: string;
    sfxCue: SfxCueType;
    beatKind: BeatKind;
    statValue?: string;
    statUnit?: string;
    visualAction: string;
  }> = [
    {
      title: 'The Hook',
      kicker: 'THE HOOK',
      spokenLine: `Look closely at ${topic}`,
      accentPhrase: topic.split(/\s+/)[0] || 'Look closely',
      sfxCue: 'impact',
      beatKind: 'media',
      visualAction: 'Dramatic close-up of protagonist staring wide-eyed at a glowing object on a dark desk.',
    },
    {
      title: 'The Number',
      kicker: 'BY THE NUMBERS',
      spokenLine: '300% faster in 8 days',
      accentPhrase: '300%',
      sfxCue: 'cashtick',
      beatKind: 'graphic-card',
      statValue: '300%',
      statUnit: 'IN 8 DAYS',
      visualAction: 'Animated counter card surging from 0% to 300%.',
    },
    {
      title: 'No Shortcuts',
      kicker: 'THE REALITY',
      spokenLine: 'No camera. No crew.',
      accentPhrase: 'No crew',
      sfxCue: 'shutter',
      beatKind: 'media',
      visualAction: 'Wide shot of an empty dark studio table with one glowing laptop screen.',
    },
    {
      title: 'Just One System',
      kicker: 'SOLO WORKFLOW',
      spokenLine: 'Just one clear system.',
      accentPhrase: 'one clear',
      sfxCue: 'thud',
      beatKind: 'graphic-card',
      visualAction: 'Editorial statement card highlighting the words ONE CLEAR SYSTEM.',
    },
    {
      title: 'First Contrast',
      kicker: 'CONCEPT A',
      spokenLine: 'Old method drags slowly,',
      accentPhrase: 'drags slowly',
      sfxCue: 'whoosh',
      beatKind: 'media',
      visualAction: 'Exhausted character buried under tangled sticky notes and messy clock hands.',
    },
    {
      title: 'Second Contrast',
      kicker: 'CONCEPT B',
      spokenLine: 'while visuals snap cleanly.',
      accentPhrase: 'snap cleanly',
      sfxCue: 'shutter',
      beatKind: 'media',
      visualAction: 'Clean minimalist grid of glowing story panels floating behind confident protagonist.',
    },
    {
      title: 'Rise Tension',
      kicker: 'MOMENTUM',
      spokenLine: 'Every word hits its mark.',
      accentPhrase: 'hits',
      sfxCue: 'keyburst',
      beatKind: 'media',
      visualAction: 'Extreme low-angle macro shot of protagonist hands typing fast in rim light.',
    },
    {
      title: 'Scale Proof',
      kicker: 'GROWTH',
      spokenLine: '200,000 people stopped scrolling',
      accentPhrase: '200,000',
      sfxCue: 'cashtick',
      beatKind: 'graphic-card',
      statValue: '200,000',
      statUnit: 'VIEWERS',
      visualAction: 'Rolling stat card surging up to 200,000.',
    },
    {
      title: 'Closing Shift',
      kicker: 'THE SECRET',
      spokenLine: 'Speed plus contrast wins.',
      accentPhrase: 'wins',
      sfxCue: 'flashwhoosh',
      beatKind: 'media',
      visualAction: 'Hero standing silhouette against dramatic warm doorway light.',
    },
  ];

  const scenes: BlueprintScene[] = [];
  for (let i = 0; i < sceneCount; i++) {
    const tpl = templates[i % templates.length];
    const graphicCard: GraphicCardData | undefined =
      tpl.beatKind === 'graphic-card'
        ? tpl.statValue
          ? {
              cardType: 'stat-counter',
              theme: cardTheme,
              headline: tpl.spokenLine,
              statValue: tpl.statValue,
              statUnit: tpl.statUnit,
              kicker: tpl.kicker,
            }
          : {
              cardType: 'statement',
              theme: cardTheme,
              headline: tpl.spokenLine,
              kicker: tpl.kicker,
            }
        : undefined;

    scenes.push({
      index: i,
      title: `${tpl.title}${i >= templates.length ? ` ${Math.floor(i / templates.length) + 1}` : ''}`,
      kicker: i >= templates.length ? `BEAT ${String(i + 1).padStart(2, '0')}` : tpl.kicker,
      spokenLine: tpl.spokenLine,
      accentPhrase: tpl.accentPhrase,
      sfxCue: tpl.sfxCue,
      beatKind: tpl.beatKind,
      graphicCard,
      visualAction: tpl.visualAction,
      imagePrompt:
        tpl.beatKind === 'graphic-card'
          ? `AUTO $0 GRAPHIC CARD — ${tpl.visualAction} (no external image needed, or optionally upload custom visual)`
          : `${preset.characterAnchor} Beat ${i + 1}: ${tpl.visualAction} ${preset.masterStyleAnchor} ${aspectHint}`,
    });
  }

  return {
    id: `bp_${crypto.randomBytes(4).toString('hex')}`,
    topic,
    language,
    artStyleId: preset.id,
    artStyleLabel: preset.label,
    categoryLabel: preset.categoryLabel,
    characterAnchor: preset.characterAnchor,
    masterStyleAnchor: preset.masterStyleAnchor,
    continuityPrefix: preset.continuityPrefix,
    fullScript: scenes.map((s) => s.spokenLine).join(' '),
    scenes,
    engineUsed: 'local-template',
    fallbackNotice,
  };
}

export interface GenerateTtsInput {
  script: string;
  voiceName: TtsVoiceName;
  deliveryStyle: string;
  destPath: string;
}

export async function generateBlueprintVoiceoverWav(input: GenerateTtsInput): Promise<void> {
  const client = getGeminiClient();
  if (!client) {
    throw new Error(
      'GEMINI_API_KEY is required for AI voiceover generation. You can still paste your own recorded .mp3/.wav at $0 cost.'
    );
  }

  const cleanText = input.script.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  if (!cleanText) {
    throw new Error('Voiceover script cannot be empty.');
  }

  const voice = input.voiceName || 'Charon';
  const style =
    input.deliveryStyle.trim() ||
    'Deep, engaging short-form documentary narrator, clear articulation and natural dramatic pacing';

  const response = await client.models.generateContent({
    model: 'gemini-3.8-flash-lite-tts',
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: cleanText,
            speechMetadata: {
              style,
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName: voice },
        },
      },
    },
  });

  const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
  if (!base64Audio) {
    throw new Error(
      'Gemini TTS did not return audio data. Try shortening the script or check your API key.'
    );
  }

  const wavBuffer = Buffer.from(base64Audio, 'base64');
  await fs.writeFile(input.destPath, wavBuffer);
}
