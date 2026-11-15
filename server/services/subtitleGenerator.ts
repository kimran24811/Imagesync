import fs from 'node:fs/promises';
import type {
  AccentColorId,
  AspectRatio,
  CaptionMode,
  FontStyleId,
  SceneItem,
  TextEffectId,
} from '../../src/types/studio.ts';
import {
  buildDynamicCaptionFrames,
  isRtlText,
  type CaptionWordToken,
} from '../../src/utils/captions.ts';

const ASS_ACCENT_BGR: Record<AccentColorId, string> = {
  coral: '&H5E3FF4&',
  gold: '&H0B9EF5&',
  cyan: '&HF8BD38&',
  emerald: '&H81B910&',
};

function formatAssTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const hours = Math.floor(safe / 3600000);
  const minutes = Math.floor((safe % 3600000) / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  const centis = Math.floor((safe % 1000) / 10);
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centis).padStart(2, '0')}`;
}

function escapeAssText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\r?\n/g, ' ')
    .trim();
}

function resolveFontFamilies(
  fontStyle: FontStyleId,
  hasRtl: boolean
): { kickerFont: string; bodyFont: string; accentFont: string } {
  if (hasRtl) {
    return {
      kickerFont: 'Noto Sans',
      bodyFont: 'Noto Sans Arabic',
      accentFont: 'Noto Sans Arabic',
    };
  }
  switch (fontStyle) {
    case 'mixed-editorial':
      return {
        kickerFont: 'JetBrains Mono',
        bodyFont: 'Liberation Sans',
        accentFont: 'Liberation Serif',
      };
    case 'editorial-serif':
      return {
        kickerFont: 'Liberation Sans',
        bodyFont: 'Liberation Serif',
        accentFont: 'Liberation Serif',
      };
    case 'mono-tech':
      return {
        kickerFont: 'JetBrains Mono',
        bodyFont: 'JetBrains Mono',
        accentFont: 'JetBrains Mono',
      };
    default:
      return {
        kickerFont: 'Liberation Sans',
        bodyFont: 'Liberation Sans',
        accentFont: 'Liberation Sans',
      };
  }
}

function wrapWordTokens(
  words: CaptionWordToken[],
  maxCharsPerLine: number,
  maxLines: number
): CaptionWordToken[][] {
  const lines: CaptionWordToken[][] = [];
  let current: CaptionWordToken[] = [];
  let len = 0;

  for (const token of words) {
    const tLen = token.display.length;
    if (current.length === 0) {
      current.push(token);
      len = tLen;
    } else if (len + 1 + tLen <= maxCharsPerLine) {
      current.push(token);
      len += 1 + tLen;
    } else {
      lines.push(current);
      current = [token];
      len = tLen;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.slice(0, maxLines);
}

function formatDynamicAssTokens(
  lines: CaptionWordToken[][],
  accentBgr: string,
  baseSize: number,
  accentSize: number,
  bodyFont: string,
  accentFont: string,
  textEffect: TextEffectId
): string {
  const baseColor = '&HFFFFFF&';
  const dimColor = '&H94A3B8&';

  return lines
    .map((lineTokens) =>
      lineTokens
        .map((tok) => {
          const safe = escapeAssText(tok.display);
          if (textEffect === 'kinetic-karaoke') {
            if (tok.isActiveWord) {
              const boost = tok.isNumeric ? Math.round(accentSize * 1.12) : accentSize;
              return `{\\fn${accentFont}\\fs${boost}\\b1\\c${accentBgr}}${safe}{\\fn${bodyFont}\\fs${baseSize}\\b1\\c${baseColor}}`;
            }
            if (tok.isAccent || tok.isNumeric) {
              return `{\\fn${accentFont}\\fs${Math.round(baseSize * 1.12)}\\b1\\c${baseColor}}${safe}{\\fn${bodyFont}\\fs${baseSize}\\b1\\c${baseColor}}`;
            }
            return `{\\c${dimColor}}${safe}{\\c${baseColor}}`;
          }

          if (tok.isNumeric) {
            return `{\\fn${accentFont}\\fs${Math.round(accentSize * 1.15)}\\b1\\c${accentBgr}}${safe}{\\fn${bodyFont}\\fs${baseSize}\\b1\\c${baseColor}}`;
          }
          if (tok.isAccent || (textEffect === 'type-reveal' && tok.isActiveWord)) {
            return `{\\fn${accentFont}\\fs${accentSize}\\b1\\c${accentBgr}}${safe}{\\fn${bodyFont}\\fs${baseSize}\\b1\\c${baseColor}}`;
          }
          return safe;
        })
        .join(' ')
    )
    .join('\\N');
}

function buildMotionOverrideTag(
  textEffect: TextEffectId,
  x: number,
  y: number,
  alignNum: number
): string {
  switch (textEffect) {
    case 'punch-pop':
      return `\\an${alignNum}\\pos(${x},${y})\\fscx84\\fscy84\\t(0,75,\\fscx110\\fscy110)\\t(75,160,\\fscx100\\fscy100)`;
    case 'slide-up':
      return `\\an${alignNum}\\move(${x},${y + 34},${x},${y},0,170)\\fad(80,45)`;
    case 'type-reveal':
    case 'kinetic-karaoke':
      return `\\an${alignNum}\\pos(${x},${y})\\fscx94\\fscy94\\t(0,55,\\fscx105\\fscy105)\\t(55,115,\\fscx100\\fscy100)`;
    case 'highlight-box':
    default:
      return `\\an${alignNum}\\pos(${x},${y})\\fad(65,45)`;
  }
}

export interface SubtitleRenderOptions {
  captionMode: CaptionMode;
  textEffect: TextEffectId;
  fontStyle: FontStyleId;
  accentColor: AccentColorId;
  brandKicker?: string;
}

export async function writeAssSubtitleFile(
  destPath: string,
  scenes: SceneItem[],
  aspectRatio: AspectRatio,
  options: SubtitleRenderOptions = {
    captionMode: 'explainer-kinetic',
    textEffect: 'type-reveal',
    fontStyle: 'modern-sans',
    accentColor: 'coral',
    brandKicker: '',
  }
): Promise<void> {
  const playResX = aspectRatio === '9:16' ? 1080 : 1920;
  const playResY = aspectRatio === '9:16' ? 1920 : 1080;
  const accentBgr = ASS_ACCENT_BGR[options.accentColor] ?? ASS_ACCENT_BGR.coral;
  const mode = options.captionMode;
  const effect = options.textEffect || 'type-reveal';
  const fontStyle = options.fontStyle || 'modern-sans';
  const brand = (options.brandKicker ?? '').trim();

  const allText = scenes.map((s) => s.text).join(' ');
  const scriptHasRtl = isRtlText(allText);
  const { kickerFont, bodyFont, accentFont } = resolveFontFamilies(fontStyle, scriptHasRtl);
  const isBoxStyle = effect === 'highlight-box';

  if (mode === 'explainer-kinetic') {
    const marginH = aspectRatio === '9:16' ? 84 : 128;
    const topKickerY = aspectRatio === '9:16' ? 148 : 88;
    const topHeadlineY = aspectRatio === '9:16' ? 208 : 138;
    const centerHeadlineY = aspectRatio === '9:16' ? 920 : 540;
    const lowerHeadlineY = aspectRatio === '9:16' ? 1460 : 880;
    const cardSubY = aspectRatio === '9:16' ? 1660 : 970;

    const kickerSize = aspectRatio === '9:16' ? 30 : 28;
    const baseSize = aspectRatio === '9:16' ? 74 : 66;
    const accentSize = aspectRatio === '9:16' ? 98 : 88;
    const maxCharsPerLine = aspectRatio === '9:16' ? 16 : 26;

    const borderStyle = isBoxStyle ? 3 : 1;
    const backCol = isBoxStyle ? '&H300F172A&' : '&HAA000000';
    const outlineWidth = isBoxStyle ? 14 : 4.2;

    const header = `[Script Info]
Title: SceneSync Studio v5 Viral Explainer Kinetic Captions
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Kicker,${kickerFont},${kickerSize},&HE2E8F0&,&HFFFFFF&,&H000F172A,&H90000000,-1,0,0,0,100,100,1.8,0,1,2.4,1.0,7,${marginH},${marginH},40,1
Style: KineticMain,${bodyFont},${baseSize},&H00FFFFFF,&H00FFFFFF,&H000B0F19,${backCol},-1,0,0,0,100,100,0.4,0,${borderStyle},${outlineWidth},2.2,7,${marginH},${marginH},40,1
Style: CardSub,${bodyFont},${aspectRatio === '9:16' ? 40 : 38},&HE2E8F0&,&HFFFFFF&,&H000B0F19,&H88000000,-1,0,0,0,100,100,0.3,0,1,2.6,1.2,2,${marginH},${marginH},50,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const dialogues: string[] = [];

    for (const scene of scenes) {
      const sceneRtl = isRtlText(scene.text);

      // Graphic card scenes already display huge vector headline/counter—avoid collision!
      if (scene.beatKind === 'graphic-card') {
        if (brand) {
          dialogues.push(
            `Dialogue: 1,${formatAssTime(scene.startMs)},${formatAssTime(scene.endMs)},CardSub,,0,0,0,,{\\an2\\pos(${Math.round(playResX / 2)},${cardSubY})\\fad(60,50)}${escapeAssText(brand)}`
          );
        }
        continue;
      }

      const zone = scene.captionZone ?? 'top-banner';
      let alignNum = sceneRtl ? 9 : 7;
      let anchorX = sceneRtl ? playResX - marginH : marginH;
      let headlineY = topHeadlineY;

      if (zone === 'center-impact') {
        alignNum = 5;
        anchorX = Math.round(playResX / 2);
        headlineY = centerHeadlineY;
      } else if (zone === 'lower-hero') {
        alignNum = 2;
        anchorX = Math.round(playResX / 2);
        headlineY = lowerHeadlineY;
      }

      if (zone === 'top-banner') {
        const sceneKicker = (scene.kicker ?? '').trim();
        const kickerLabel =
          brand && sceneKicker
            ? `${brand}  ·  ${sceneKicker}`
            : brand || sceneKicker || `BEAT ${String(scene.index + 1).padStart(2, '0')}`;

        dialogues.push(
          `Dialogue: 1,${formatAssTime(scene.startMs)},${formatAssTime(scene.endMs)},Kicker,,0,0,0,,{\\an${alignNum}\\pos(${anchorX},${topKickerY})\\fad(65,45)}{\\c${accentBgr}}● {\\c&HE2E8F0&}${escapeAssText(kickerLabel.toUpperCase())}`
        );
      }

      const frames = buildDynamicCaptionFrames(scene, mode, effect, aspectRatio);
      for (const frame of frames) {
        const lines = wrapWordTokens(frame.words, maxCharsPerLine, 3);
        const formatted = formatDynamicAssTokens(
          lines,
          accentBgr,
          baseSize,
          accentSize,
          bodyFont,
          accentFont,
          effect
        );
        const motionTag = buildMotionOverrideTag(effect, anchorX, headlineY, alignNum);
        dialogues.push(
          `Dialogue: 2,${formatAssTime(frame.startMs)},${formatAssTime(frame.endMs)},KineticMain,,0,0,0,,{${motionTag}}${formatted}`
        );
      }
    }

    await fs.writeFile(destPath, header + dialogues.join('\n') + '\n', 'utf8');
    return;
  }

  if (mode === 'word-pop') {
    const centerX = Math.round(playResX / 2);
    const centerY = aspectRatio === '9:16' ? 1280 : 810;
    const baseSize = aspectRatio === '9:16' ? 82 : 76;
    const accentSize = aspectRatio === '9:16' ? 106 : 96;
    const borderStyle = isBoxStyle ? 3 : 1;
    const backCol = isBoxStyle ? '&H300F172A&' : '&HAA000000';
    const outlineWidth = isBoxStyle ? 15 : 4.5;

    const header = `[Script Info]
Title: SceneSync Studio Word-Pop Captions
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: WordPop,${bodyFont},${baseSize},&H00FFFFFF,&H00FFFFFF,&H000B0F19,${backCol},-1,0,0,0,100,100,0.6,0,${borderStyle},${outlineWidth},2.2,5,60,60,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

    const dialogues: string[] = [];
    for (const scene of scenes) {
      if (scene.beatKind === 'graphic-card') continue;
      const frames = buildDynamicCaptionFrames(scene, mode, effect, aspectRatio);
      for (const frame of frames) {
        const formatted = formatDynamicAssTokens(
          [frame.words],
          accentBgr,
          baseSize,
          accentSize,
          bodyFont,
          accentFont,
          effect
        );
        const motionTag = buildMotionOverrideTag(effect, centerX, centerY, 5);
        dialogues.push(
          `Dialogue: 0,${formatAssTime(frame.startMs)},${formatAssTime(frame.endMs)},WordPop,,0,0,0,,{${motionTag}}${formatted}`
        );
      }
    }

    await fs.writeFile(destPath, header + dialogues.join('\n') + '\n', 'utf8');
    return;
  }

  // 'bottom-third'
  const centerX = Math.round(playResX / 2);
  const bottomY = aspectRatio === '9:16' ? 1660 : 980;
  const marginH = aspectRatio === '9:16' ? 76 : 160;
  const fontSize = aspectRatio === '9:16' ? 52 : 56;
  const accentSize = aspectRatio === '9:16' ? 64 : 68;
  const maxCharsPerLine = aspectRatio === '9:16' ? 25 : 42;
  const borderStyle = isBoxStyle ? 3 : 1;
  const backCol = isBoxStyle ? '&H380F172A&' : '&H96000000';
  const outlineWidth = isBoxStyle ? 11 : 3.2;

  const header = `[Script Info]
Title: SceneSync Studio Subtitles
ScriptType: v4.00+
PlayResX: ${playResX}
PlayResY: ${playResY}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cinematic,${bodyFont},${fontSize},&H00FFFFFF,&H00FFFFFF,&H00121218,${backCol},-1,0,0,0,100,100,0.4,0,${borderStyle},${outlineWidth},1.4,2,${marginH},${marginH},80,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogues: string[] = [];
  for (const scene of scenes) {
    if (scene.beatKind === 'graphic-card') continue;
    const frames = buildDynamicCaptionFrames(scene, mode, effect, aspectRatio);
    for (const frame of frames) {
      const lines = wrapWordTokens(frame.words, maxCharsPerLine, 2);
      const formatted = formatDynamicAssTokens(
        lines,
        accentBgr,
        fontSize,
        accentSize,
        bodyFont,
        accentFont,
        effect
      );
      const motionTag = buildMotionOverrideTag(effect, centerX, bottomY, 2);
      dialogues.push(
        `Dialogue: 0,${formatAssTime(frame.startMs)},${formatAssTime(frame.endMs)},Cinematic,,0,0,0,,{${motionTag}}${formatted}`
      );
    }
  }

  await fs.writeFile(destPath, header + dialogues.join('\n') + '\n', 'utf8');
}
