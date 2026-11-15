import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AccentColorId,
  AspectRatio,
  GraphicCardData,
  SceneItem,
} from '../../src/types/studio.ts';
import { ACCENT_COLOR_HEX } from '../../src/utils/captions.ts';
import { spawnStreamCommand } from './execUtils.ts';
import { Resvg } from '@resvg/resvg-js';

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wrapLines(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';

  for (const w of words) {
    if (!cur) {
      cur = w;
    } else if (cur.length + 1 + w.length <= maxChars) {
      cur += ' ' + w;
    } else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, maxLines);
}

interface PaletteTokens {
  bgTop: string;
  bgBottom: string;
  surface: string;
  border: string;
  fg: string;
  muted: string;
  accent: string;
  pillText: string;
}

function resolvePalette(
  card: GraphicCardData,
  accentColor: AccentColorId
): PaletteTokens {
  const accentHex = ACCENT_COLOR_HEX[accentColor]?.hex ?? '#F43F5E';

  if (card.theme === 'cream-poster') {
    return {
      bgTop: '#FAF6EE',
      bgBottom: '#EFE7D8',
      surface: '#FFFFFF',
      border: '#D6CCBA',
      fg: '#0F172A',
      muted: '#475569',
      accent: accentHex,
      pillText: '#FFFFFF',
    };
  }
  if (card.theme === 'noir-gold') {
    return {
      bgTop: '#0D0E12',
      bgBottom: '#050608',
      surface: '#14161D',
      border: '#2B2F3C',
      fg: '#F8FAFC',
      muted: '#94A3B8',
      accent: '#F59E0B',
      pillText: '#09090B',
    };
  }
  return {
    bgTop: '#121726',
    bgBottom: '#070A12',
    surface: '#161D2F',
    border: '#25304A',
    fg: '#FFFFFF',
    muted: '#94A3B8',
    accent: accentHex,
    pillText: '#FFFFFF',
  };
}

/**
 * Formats an interpolated stat number while keeping original prefix/suffix (e.g. "$200,000+" or "32M").
 */
function interpolateStatText(target: string, progress: number): string {
  if (progress >= 0.999) return target;
  const match = target.match(/^([^0-9]*)([\d,.]+)(.*)$/);
  if (!match) return target;

  const prefix = match[1] ?? '';
  const numStr = match[2];
  const suffix = match[3] ?? '';

  const hasComma = numStr.includes(',');
  const decimalMatch = numStr.match(/\.(\d+)/);
  const decimals = decimalMatch ? decimalMatch[1].length : 0;
  const cleanVal = Number(numStr.replace(/,/g, ''));
  if (!Number.isFinite(cleanVal)) return target;

  const eased = 1 - Math.pow(1 - progress, 2.4);
  const curVal = cleanVal * eased;

  let formatted = decimals > 0 ? curVal.toFixed(decimals) : String(Math.round(curVal));
  if (hasComma && decimals === 0) {
    formatted = Number(formatted).toLocaleString('en-US');
  }
  return `${prefix}${formatted}${suffix}`;
}

function buildGraphicCardSvg(
  card: GraphicCardData,
  width: number,
  height: number,
  accentColor: AccentColorId,
  statProgress = 1
): string {
  const pal = resolvePalette(card, accentColor);
  const isPortrait = height > width;
  const cx = width / 2;
  const cy = height / 2;
  const kickerText = (card.kicker || '').trim().toUpperCase();
  const isLightBg = card.theme === 'cream-poster';

  const gridStroke = isLightBg ? 'rgba(15,23,42,0.06)' : 'rgba(255,255,255,0.05)';
  const subtleFrameMargin = isPortrait ? 64 : 84;

  let bodySvg = '';

  if (card.cardType === 'stat-counter') {
    const rawStat = (card.statValue || card.headline || '100%').trim();
    const displayStat = interpolateStatText(rawStat, statProgress);
    const unitText = (card.statUnit || '').trim().toUpperCase();
    const subLines = wrapLines(card.headline || '', isPortrait ? 22 : 34, 2);

    const statLen = displayStat.length;
    const statFontSize =
      statLen <= 4
        ? isPortrait ? 220 : 210
        : statLen <= 7
          ? isPortrait ? 168 : 175
          : isPortrait ? 128 : 148;

    const barMaxW = isPortrait ? 640 : 840;
    const barW = Math.max(40, Math.round(barMaxW * (0.2 + 0.8 * statProgress)));
    const statY = cy - (subLines.length > 0 ? 35 : 0);

    bodySvg = `
      ${
        kickerText
          ? `<text x="${cx}" y="${statY - statFontSize * 0.92}" text-anchor="middle" font-family="JetBrains Mono, Liberation Sans, sans-serif" font-weight="700" font-size="${isPortrait ? 30 : 28}" letter-spacing="5" fill="${pal.accent}">${escapeXml(kickerText)}</text>`
          : ''
      }
      <text x="${cx}" y="${statY}" text-anchor="middle" font-family="Liberation Sans, Noto Sans, sans-serif" font-weight="900" font-size="${statFontSize}" letter-spacing="-3" fill="${pal.fg}">${escapeXml(displayStat)}</text>
      ${
        unitText
          ? `<text x="${cx}" y="${statY + 68}" text-anchor="middle" font-family="JetBrains Mono, Liberation Sans, sans-serif" font-weight="700" font-size="${isPortrait ? 34 : 32}" letter-spacing="4" fill="${pal.muted}">${escapeXml(unitText)}</text>`
          : ''
      }
      <rect x="${cx - barMaxW / 2}" y="${statY + 110}" width="${barMaxW}" height="12" rx="6" fill="${pal.border}" />
      <rect x="${cx - barMaxW / 2}" y="${statY + 110}" width="${barW}" height="12" rx="6" fill="${pal.accent}" />
      ${subLines
        .map(
          (ln, i) =>
            `<text x="${cx}" y="${statY + 188 + i * 54}" text-anchor="middle" font-family="Liberation Sans, Noto Sans Arabic, sans-serif" font-weight="700" font-size="${isPortrait ? 42 : 40}" fill="${pal.fg}">${escapeXml(ln)}</text>`
        )
        .join('\n      ')}
    `;
  } else if (card.cardType === 'split-contrast') {
    const leftText = (card.leftLabel || 'BEFORE').trim();
    const rightText = (card.rightLabel || 'AFTER').trim();
    const headLines = wrapLines(card.headline || `${leftText} vs ${rightText}`, isPortrait ? 20 : 30, 2);

    const panelW = isPortrait ? width - 160 : Math.round((width - 280) / 2);
    const panelH = isPortrait ? 360 : 420;
    const gap = 36;

    if (isPortrait) {
      const topY = cy - panelH - gap / 2 + 20;
      const botY = cy + gap / 2 + 20;
      const lx = (width - panelW) / 2;

      bodySvg = `
        ${headLines
          .map(
            (ln, i) =>
              `<text x="${cx}" y="${topY - 95 + i * 52}" text-anchor="middle" font-family="Liberation Sans, Noto Sans Arabic, sans-serif" font-weight="800" font-size="44" fill="${pal.muted}">${escapeXml(ln)}</text>`
          )
          .join('\n')}
        <rect x="${lx}" y="${topY}" width="${panelW}" height="${panelH}" rx="28" fill="${pal.surface}" stroke="${pal.border}" stroke-width="3" />
        <text x="${cx}" y="${topY + panelH / 2 + 24}" text-anchor="middle" font-family="Liberation Sans, Noto Sans Arabic, sans-serif" font-weight="900" font-size="${leftText.length > 14 ? 54 : 74}" fill="${pal.fg}">${escapeXml(leftText)}</text>

        <circle cx="${cx}" cy="${cy + 20}" r="42" fill="${pal.accent}" />
        <text x="${cx}" y="${cy + 31}" text-anchor="middle" font-family="JetBrains Mono, Liberation Sans, sans-serif" font-weight="900" font-size="28" fill="${pal.pillText}">VS</text>

        <rect x="${lx}" y="${botY}" width="${panelW}" height="${panelH}" rx="28" fill="${pal.accent}" />
        <text x="${cx}" y="${botY + panelH / 2 + 24}" text-anchor="middle" font-family="Liberation Sans, Noto Sans Arabic, sans-serif" font-weight="900" font-size="${rightText.length > 14 ? 54 : 74}" fill="${pal.pillText}">${escapeXml(rightText)}</text>
      `;
    } else {
      const leftX = 110;
      const rightX = cx + 30;
      const boxY = cy - panelH / 2 + 30;

      bodySvg = `
        ${headLines
          .map(
            (ln, i) =>
              `<text x="${cx}" y="${boxY - 76 + i * 48}" text-anchor="middle" font-family="Liberation Sans, Noto Sans Arabic, sans-serif" font-weight="800" font-size="42" fill="${pal.muted}">${escapeXml(ln)}</text>`
          )
          .join('\n')}
        <rect x="${leftX}" y="${boxY}" width="${panelW}" height="${panelH}" rx="28" fill="${pal.surface}" stroke="${pal.border}" stroke-width="3" />
        <text x="${leftX + panelW / 2}" y="${boxY + panelH / 2 + 22}" text-anchor="middle" font-family="Liberation Sans, Noto Sans Arabic, sans-serif" font-weight="900" font-size="${leftText.length > 14 ? 50 : 68}" fill="${pal.fg}">${escapeXml(leftText)}</text>

        <rect x="${rightX}" y="${boxY}" width="${panelW}" height="${panelH}" rx="28" fill="${pal.accent}" />
        <text x="${rightX + panelW / 2}" y="${boxY + panelH / 2 + 22}" text-anchor="middle" font-family="Liberation Sans, Noto Sans Arabic, sans-serif" font-weight="900" font-size="${rightText.length > 14 ? 50 : 68}" fill="${pal.pillText}">${escapeXml(rightText)}</text>

        <circle cx="${cx}" cy="${boxY + panelH / 2}" r="42" fill="${pal.bgTop}" stroke="${pal.accent}" stroke-width="5" />
        <text x="${cx}" y="${boxY + panelH / 2 + 11}" text-anchor="middle" font-family="JetBrains Mono, Liberation Sans, sans-serif" font-weight="900" font-size="26" fill="${pal.fg}">VS</text>
      `;
    }
  } else {
    // Editorial Bold Statement Poster Card
    const lines = wrapLines(card.headline || '', isPortrait ? 13 : 22, 4);
    const fontSize =
      lines.length <= 2
        ? isPortrait ? 96 : 86
        : isPortrait ? 78 : 72;
    const lineHeight = Math.round(fontSize * 1.24);
    const totalH = lines.length * lineHeight;
    const startY = cy - totalH / 2 + fontSize * 0.72;

    const pillW = Math.min(width - 180, (lines[lines.length - 1]?.length ?? 6) * (fontSize * 0.56) + 64);
    const lastLineY = startY + (lines.length - 1) * lineHeight;

    bodySvg = `
      ${
        kickerText
          ? `<text x="${cx}" y="${startY - lineHeight * 0.95}" text-anchor="middle" font-family="JetBrains Mono, Liberation Sans, sans-serif" font-weight="800" font-size="${isPortrait ? 30 : 28}" letter-spacing="5" fill="${pal.accent}">${escapeXml(kickerText)}</text>`
          : ''
      }
      <rect x="${cx - pillW / 2}" y="${lastLineY - fontSize * 0.88}" width="${pillW}" height="${Math.round(fontSize * 1.18)}" rx="18" fill="${pal.accent}" />
      ${lines
        .map((ln, idx) => {
          const isLast = idx === lines.length - 1;
          return `<text x="${cx}" y="${startY + idx * lineHeight}" text-anchor="middle" font-family="Liberation Sans, Noto Sans Arabic, sans-serif" font-weight="900" font-size="${fontSize}" fill="${isLast ? pal.pillText : pal.fg}">${escapeXml(ln)}</text>`;
        })
        .join('\n      ')}
    `;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="${pal.bgTop}" />
      <stop offset="100%" stop-color="${pal.bgBottom}" />
    </linearGradient>
    <pattern id="gridPat" width="60" height="60" patternUnits="userSpaceOnUse">
      <path d="M 60 0 L 0 0 0 60" fill="none" stroke="${gridStroke}" stroke-width="1.5" />
    </pattern>
  </defs>
  <rect width="${width}" height="${height}" fill="url(#bgGrad)" />
  <rect width="${width}" height="${height}" fill="url(#gridPat)" />
  <rect x="${subtleFrameMargin}" y="${subtleFrameMargin}" width="${width - subtleFrameMargin * 2}" height="${height - subtleFrameMargin * 2}" rx="36" fill="none" stroke="${pal.border}" stroke-width="2" />
  ${bodySvg}
</svg>`;
}

/**
 * Generates an animated 1080p MP4 segment for a $0 Graphic Card beat.
 * Every card is rasterized to PNG in Node before FFmpeg: Windows FFmpeg 9
 * essentials builds do not provide SVG input decoding. No external decoder is required.
 */
/**
 * Rasterize our own trusted SVG markup using a cross-platform Node renderer.
 * FFmpeg only receives ordinary PNG input, including for stepped counter cards.
 */
export async function rasterizeGraphicCardSvg(svg: string, pngPath: string): Promise<void> {
  const png = new Resvg(svg, {
    fitTo: { mode: 'original' },
    font: { loadSystemFonts: true },
  }).render().asPng();
  await fs.writeFile(pngPath, png);
}

export async function renderGraphicCardSegmentMp4(params: {
  scene: SceneItem;
  aspectRatio: AspectRatio;
  accentColor: AccentColorId;
  frames: number;
  renderDir: string;
  segPath: string;
  encoderArgs: string[];
}): Promise<void> {
  const width = params.aspectRatio === '9:16' ? 1080 : 1920;
  const height = params.aspectRatio === '9:16' ? 1920 : 1080;
  const card: GraphicCardData = params.scene.graphicCard ?? {
    cardType: 'statement',
    theme: 'obsidian',
    headline: params.scene.text,
    kicker: params.scene.kicker,
  };

  const fps = 30;
  const durationSec = (params.frames / fps).toFixed(4);
  const upW = Math.round(width * 1.16);
  const upH = Math.round(height * 1.16);

  if (card.cardType === 'stat-counter' && params.frames >= 18) {
    // Render 5 progressive PNG counter steps + final hold with subtle zoompunch settle
    const steps = [0.18, 0.45, 0.72, 0.91, 1.0];
    const stepListPath = path.join(params.renderDir, `card_${params.scene.index}_steps.txt`);
    const concatEntries: string[] = [];

    const animFrames = Math.min(Math.floor(params.frames * 0.58), 20);
    const perStepFrames = Math.max(2, Math.floor(animFrames / (steps.length - 1)));
    let usedFrames = 0;

    for (let s = 0; s < steps.length; s++) {
      const pngPath = path.join(params.renderDir, `card_${params.scene.index}_s${s}.png`);
      await rasterizeGraphicCardSvg(
        buildGraphicCardSvg(card, width, height, params.accentColor, steps[s]),
        pngPath
      );
      const stepFrames =
        s === steps.length - 1 ? Math.max(2, params.frames - usedFrames) : perStepFrames;
      usedFrames += stepFrames;
      const safePath = pngPath.replace(/\\/g, '/').replace(/'/g, "'\\''");
      concatEntries.push(`file '${safePath}'`);
      concatEntries.push(`duration ${(stepFrames / fps).toFixed(4)}`);
    }
    const lastPng = path.join(params.renderDir, `card_${params.scene.index}_s${steps.length - 1}.png`);
    concatEntries.push(`file '${lastPng.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
    await fs.writeFile(stepListPath, concatEntries.join('\n'), 'utf8');

    const denom = Math.max(1, params.frames - 1);
    await spawnStreamCommand('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      stepListPath,
      '-vf',
      `fps=${fps},scale=${upW}:${upH},zoompan=z='1.06-0.05*exp(-on/4.5)+0.03*on/${denom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=${fps},format=yuv420p`,
      '-t',
      durationSec,
      '-frames:v',
      String(params.frames),
      '-r',
      String(fps),
      ...params.encoderArgs,
      '-an',
      '-movflags',
      '+faststart',
      params.segPath,
    ]);
    return;
  }

  // Statement & split-contrast card with crisp snap-settle punch zoom
  const pngPath = path.join(params.renderDir, `card_${params.scene.index}.png`);
  await rasterizeGraphicCardSvg(
    buildGraphicCardSvg(card, width, height, params.accentColor, 1),
    pngPath
  );
  const denom = Math.max(1, params.frames - 1);

  await spawnStreamCommand('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    pngPath,
    '-vf',
    `scale=${upW}:${upH},zoompan=z='1.02+0.12*exp(-on/3.2)+0.04*on/${denom}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${params.frames}:s=${width}x${height}:fps=${fps},format=yuv420p`,
    '-frames:v',
    String(params.frames),
    '-r',
    String(fps),
    ...params.encoderArgs,
    '-an',
    '-movflags',
    '+faststart',
    params.segPath,
  ]);
}
