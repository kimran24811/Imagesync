import type { AspectRatio, SceneItem } from '../types/studio.ts';
import { DIRECTOR_PRESETS, type MotionDesign, type TimedWord } from './types.ts';

export const xml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
export const clamp = (n: number, low = 0, high = 1) => Math.max(low, Math.min(high, n));
const ease = (p: number) => 1 - Math.pow(1 - clamp(p), 3);
const spring = (p: number) => {
  const t = clamp(p);
  return t === 1 ? 1 : 1 - Math.exp(-7 * t) * Math.cos(10 * t);
};
const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const textWidth = (text: string, size: number) =>
  Array.from(text).reduce(
    (sum, c) => sum + (/[ilIt.,' ]/.test(c) ? 0.34 : /[MW@]/.test(c) ? 0.98 : 0.72) * size,
    0
  );
export function wrapText(text: string, maxWidth: number, size: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/)) {
    if (!word) continue;
    if (line && textWidth(`${line} ${word}`, size) > maxWidth) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}
function textLines(
  text: string,
  x: number,
  y: number,
  width: number,
  size: number,
  color: string,
  accent: string,
  accentText: string,
  opts: {
    center?: boolean;
    weight?: number;
    leading?: number;
    maxLines?: number;
    reveal?: number;
    tracking?: number;
  } = {}
) {
  let font = size,
    lines = wrapText(text, width, font);
  while (lines.length > (opts.maxLines ?? 4) && font > 24) {
    font -= 2;
    lines = wrapText(text, width, font);
  }
  const accents = new Set(accentText.split(/\s+/).map(normalize));
  let chars = 0;
  return lines
    .map((line, i) => {
      const visible =
        opts.reveal === undefined
          ? line
          : line.slice(0, Math.max(0, Math.floor(text.length * opts.reveal) - chars));
      chars += line.length + 1;
      // Wrap very long unbroken words to the available width using textLength.
      const length = textWidth(visible, font);
      const spans = visible
        .split(/(\s+)/)
        .map(
          (w) =>
            `<tspan fill="${accents.has(normalize(w)) && normalize(w) ? accent : color}">${xml(w)}</tspan>`
        )
        .join('');
      const rtl = /[\u0590-\u06ff]/.test(visible);
      return `<text direction="${rtl ? 'rtl' : 'ltr'}" x="${opts.center ? x : rtl ? x + width : x}" y="${y + i * font * (opts.leading ?? 1.08)}" font-size="${font}" font-weight="${opts.weight ?? 800}" text-anchor="${opts.center ? 'middle' : 'start'}" ${length > width ? `textLength="${width}" lengthAdjust="spacingAndGlyphs"` : ''} ${opts.tracking ? `letter-spacing="${opts.tracking}"` : ''}>${spans}</text>`;
    })
    .join('');
}
function entrance(
  body: string,
  motion: MotionDesign,
  elapsed: number,
  x: number,
  y: number,
  width: number,
  height: number
) {
  const p = clamp(elapsed / 380),
    e = ease(p);
  let transform = '',
    opacity = e,
    filter = '';
  switch (motion.entrance) {
    case 'pop': {
      const s = 0.82 + 0.18 * spring(p);
      transform = `translate(${x + width / 2} ${y + height / 2}) scale(${s}) translate(${-x - width / 2} ${-y - height / 2})`;
      break;
    }
    case 'slide':
      transform = `translate(${-72 * (1 - e)} 0)`;
      break;
    case 'blur':
      transform = `translate(0 ${16 * (1 - e)})`;
      filter = p < 1 ? `filter="url(#entryBlur)"` : '';
      break;
    case 'wipe':
      return `<g clip-path="url(#entryClip)">${body}</g>`;
    case 'tracking':
      transform = `translate(0 ${12 * (1 - e)})`;
      break;
    default:
      transform = `translate(0 ${40 * (1 - e)})`;
  }
  return `<g opacity="${opacity.toFixed(3)}" transform="${transform}" ${filter}>${body}</g>`;
}
function iconMarkup(icon: MotionDesign['icon'], x: number, y: number, color: string, scale = 1) {
  const paths: Record<MotionDesign['icon'], string> = {
    money:
      '<rect x="4" y="12" width="64" height="44" rx="9"/><circle cx="36" cy="34" r="12"/><path d="M12 25h4m40 18h4"/>',
    clock: '<circle cx="36" cy="36" r="27"/><path d="M36 19v18l14 9"/>',
    idea: '<path d="M23 45c-21-22 5-48 24-31 14 14 2 26-4 33v8H25v-8zM27 63h14M36 0v5M4 24l6 3M61 25l7-3"/>',
    growth: '<path d="M8 60V39h12v21m10 0V27h12v33m10 0V10h12v50M9 27 29 13l12 5L61 1"/>',
    question:
      '<circle cx="36" cy="36" r="29"/><path d="M26 26c1-16 28-12 20 2-4 6-11 5-11 16m0 8v3"/>',
    arrow: '<path d="M5 35h55M42 15l20 20-20 20"/>',
    none: '',
  };
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">${paths[icon]}</g>`;
}
function counterText(text: string, progress: number): string {
  const match = text.match(/\d[\d,.]*/);
  if (!match || progress >= 1) return text;
  const target = Number(match[0].replace(/,/g, ''));
  if (!Number.isFinite(target)) return text;
  const decimals = (match[0].split('.')[1] || '').length;
  const value = (target * ease(progress)).toFixed(Math.min(2, decimals));
  const formatted =
    match[0].includes(',') && !decimals ? Number(value).toLocaleString('en-US') : value;
  return text.slice(0, match.index) + formatted + text.slice((match.index ?? 0) + match[0].length);
}
function wordsFor(scene: SceneItem): TimedWord[] {
  return scene.words?.length
    ? scene.words
    : scene.text
        .trim()
        .split(/\s+/)
        .map((text, i, all) => ({
          text,
          startMs: scene.startMs + ((scene.endMs - scene.startMs) * i) / all.length,
          endMs: scene.startMs + ((scene.endMs - scene.startMs) * (i + 1)) / all.length,
          source: 'inferred',
        }));
}
function captionMarkup(
  scene: SceneItem,
  nowMs: number,
  W: number,
  H: number,
  accent: string,
  light: boolean
) {
  const words = wordsFor(scene);
  const active = words.findIndex((w) => nowMs >= w.startMs && nowMs < w.endMs);
  if (active < 0) return '';
  const group = Math.floor(active / 4) * 4,
    chunk = words.slice(group, group + 4),
    size = H > W ? 42 : 28;
  const text = chunk.map((w) => w.text).join(' '),
    lines = wrapText(text, W - 160, size);
  const h = lines.length * size * 1.18 + 38,
    y = H - (H > W ? 210 : 74) - h;
  const plateW = Math.min(W - 120, Math.max(...lines.map((line) => textWidth(line, size))) + 64),
    x = (W - plateW) / 2;
  return `<g><rect x="${x}" y="${y}" width="${plateW}" height="${h}" rx="18" fill="${light ? '#12131a' : '#08090d'}" opacity="0.92"/>${textLines(text, W / 2, y + size + 14, plateW - 40, size, '#ffffff', accent, words[active].text, { center: true, maxLines: 2, leading: 1.18 })}</g>`;
}

/** One deterministic composition is evaluated at a specific timestamp by preview AND export. */
export function buildMotionSvg(
  scene: SceneItem,
  nowMs: number,
  aspect: AspectRatio,
  options: { width?: number; height?: number; captions?: boolean; brand?: string } = {}
): string {
  const motion = scene.motion;
  const width = options.width ?? (aspect === '9:16' ? 1080 : 1920),
    height = options.height ?? (aspect === '9:16' ? 1920 : 1080);
  const W = 1000,
    H = aspect === '9:16' ? (W * 16) / 9 : (W * 9) / 16,
    portrait = H > W;
  if (!motion)
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"/>`;
  const preset = DIRECTOR_PRESETS.find((p) => p.id === motion.preset) ?? DIRECTOR_PRESETS[0];
  const t = Math.max(0, nowMs - (motion.originMs ?? scene.startMs)),
    p = clamp(t / 380),
    e = ease(p),
    accent = preset.accent;
  const paper =
    motion.preset === 'educational' || motion.layout === 'chapter' || motion.layout === 'list';
  const large = portrait ? 76 : 48,
    x = 72,
    y = portrait ? 205 : 105,
    panelY = portrait ? 115 : 35,
    panelH = portrait ? 650 : 320;
  let layer = '';
  // Readability treatment leaves the source illustration visible below the headline.
  const backdrop = paper
    ? `<rect x="48" y="${panelY}" width="904" height="${panelH}" rx="24" fill="#f4efe5" opacity="${e}" filter="url(#shadow)"/>`
    : `<rect width="${W}" height="${portrait ? 900 : H}" fill="url(#shade)"/>`;
  const fg = paper ? '#171821' : '#fffaf5';
  const headline = motion.headline || scene.text;
  const reveal =
    motion.entrance === 'typewriter' ? clamp(t / Math.max(300, headline.length * 28)) : undefined;
  const title = textLines(headline, x, y, 856, large, fg, accent, motion.accent, {
    maxLines: portrait ? 4 : 3,
    reveal,
    tracking: motion.entrance === 'tracking' ? (1 - e) * 6 : undefined,
  });
  if (motion.layout === 'stat') {
    const cue = motion.cues.find((c) => c.role === 'emphasis');
    const progress = clamp((nowMs - (cue?.atMs ?? scene.startMs)) / 650);
    const number =
      motion.accent.match(/(?:[$£€₹]\s*)?\d[\d,.]*(?:%|[kKmMbB])?/)?.[0] ?? motion.accent;
    const stat = counterText(number, progress);
    layer += textLines(stat, x, y + 30, 850, portrait ? 132 : 86, fg, accent, stat, {
      maxLines: 1,
    });
    const label = headline.replace(number, '').trim();
    layer += textLines(
      label,
      x,
      y + (portrait ? 160 : 110),
      850,
      portrait ? 48 : 30,
      fg,
      accent,
      '',
      { maxLines: 3, weight: 650 }
    );
    layer += `<rect x="${x}" y="${y + (portrait ? 325 : 210)}" width="${780 * progress}" height="6" rx="3" fill="${accent}"/>`;
  } else if (motion.layout === 'chapter' || motion.layout === 'list') {
    layer += `<text x="${x}" y="${panelY + 50}" font-size="16" letter-spacing="4" fill="#72717b">${xml(options.brand || 'SCENESYNC · THE NEXT IDEA')}</text>`;
    const lines = wrapText(headline, 800, portrait ? 60 : 38);
    layer += lines
      .map((line, i) => {
        const a = ease((t - 120 - i * 130) / 320),
          base = panelY + (portrait ? 155 : 100) + i * (portrait ? 92 : 57);
        return `<g opacity="${a}" transform="translate(0 ${(1 - a) * 18})"><rect x="${x}" y="${base - 38}" width="5" height="${portrait ? 48 : 34}" rx="2" fill="${accent}"/>${textLines(line, x + 28, base, 800, portrait ? 60 : 38, fg, accent, motion.accent, { maxLines: 1 })}</g>`;
      })
      .join('');
    layer += `<rect x="${x}" y="${panelY + panelH - 40}" width="${clamp(t / Math.max(1, scene.durationMs)) * 800}" height="4" fill="${accent}"/>`;
  } else if (motion.layout === 'callout') {
    layer += `<rect x="54" y="${y - 95}" width="892" height="${Math.max(180, wrapText(headline, 810, large).length * large * 1.08 + 80)}" rx="18" fill="${motion.preset === 'cartoon-energy' ? accent : '#11121b'}" opacity="0.92" stroke="${accent}" stroke-width="${motion.preset === 'cartoon-energy' ? 7 : 2}"/>`;
    layer += textLines(
      headline,
      x + 20,
      y + 8,
      810,
      large,
      motion.preset === 'cartoon-energy' ? '#14233b' : '#fff',
      motion.preset === 'cartoon-energy' ? '#fff' : accent,
      motion.accent,
      { maxLines: portrait ? 4 : 3, reveal }
    );
  } else if (motion.layout === 'minimal') {
    layer += textLines(
      headline,
      x,
      portrait ? H - 470 : H - 160,
      850,
      portrait ? 48 : 32,
      '#fff',
      accent,
      motion.accent,
      { maxLines: 3, weight: 600 }
    );
  } else {
    layer += title;
    layer += `<rect x="${x}" y="${y + (portrait ? 345 : 205)}" width="${180 * e}" height="5" rx="2" fill="${accent}"/>`;
  }
  if (motion.secondaryText && motion.secondaryAtMs !== undefined) {
    const show = ease((nowMs - motion.secondaryAtMs) / 220);
    layer += `<g opacity="${show}" transform="translate(0 ${(1 - show) * 16})">${textLines(motion.secondaryText, x, y + (portrait ? 245 : 165), 820, portrait ? 60 : 34, accent, accent, motion.secondaryText, { maxLines: 2 })}</g>`;
  }
  if (motion.icon !== 'none' && !motion.quiet && motion.layout !== 'chapter')
    layer += iconMarkup(
      motion.icon,
      portrait ? 812 : 865,
      portrait ? y + 380 : y + 215,
      accent,
      portrait ? 0.95 : 0.65
    );
  const animated = entrance(layer, motion, t, 48, panelY, 904, panelH);
  const brand =
    !paper && options.brand
      ? `<text x="${x}" y="${portrait ? 90 : 35}" font-size="17" letter-spacing="3" fill="#f5f2eb" opacity="0.8">${xml(options.brand.slice(0, 48))}</text>`
      : '';
  const bottomShade = `<rect y="${H - (portrait ? 450 : 170)}" width="${W}" height="${portrait ? 450 : 170}" fill="url(#bottomShade)"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${W} ${H}" font-family="SceneSync Sans,DejaVu Sans,Arial,sans-serif" direction="${/[\u0600-\u06ff]/.test(scene.text) ? 'rtl' : 'ltr'}"><defs><linearGradient id="shade" x2="0" y2="1"><stop stop-color="#07080d" stop-opacity=".92"/><stop offset="1" stop-color="#07080d" stop-opacity="0"/></linearGradient><linearGradient id="bottomShade" x2="0" y2="1"><stop stop-color="#07080d" stop-opacity="0"/><stop offset="1" stop-color="#07080d" stop-opacity=".85"/></linearGradient><filter id="entryBlur"><feGaussianBlur stdDeviation="${(1 - e) * 5}"/></filter><filter id="shadow" x="-15%" y="-15%" width="130%" height="145%"><feDropShadow dx="0" dy="12" stdDeviation="14" flood-opacity=".3"/></filter><clipPath id="entryClip"><rect x="48" y="0" width="${904 * e}" height="${H}"/></clipPath></defs>${backdrop}${brand}${animated}${bottomShade}${options.captions === false ? '' : captionMarkup(scene, nowMs, W, H, accent, paper)}</svg>`;
}
