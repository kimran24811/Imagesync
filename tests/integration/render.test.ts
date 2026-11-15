import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderProjectMp4 } from '../../server/services/videoRenderer.ts';
import { runCommand, runCommandBuffer } from '../../server/services/execUtils.ts';
import { validateRenderedMp4 } from '../../server/services/renderValidation.ts';
import { probeAudioDurationMs } from '../../server/services/audioAnalyzer.ts';
import { rasterizeGraphicCardSvg } from '../../server/services/cardRenderer.ts';
import { COLORS, fixture } from './fixtures.ts';

// These tests are deliberately mandatory: a missing FFmpeg/FFprobe is a failure.
const timeout = 600_000;
const root = fileURLToPath(new URL('../fixtures/', import.meta.url));
const scripts = ['Red opens our story.', 'Green brings new growth.', 'Blue follows the river.',
  'Forty two bright ideas.', 'Purple closes our story.'];

async function temp() {
  // Exercise spaces, apostrophes, brackets, commas and Unicode in real paths.
  return fs.mkdtemp(path.join(os.tmpdir(), "SceneSync O'Brien, [字幕] "));
}

async function rgbFrames(file: string, frames: number[], width = 54, height = 96): Promise<Buffer> {
  return runCommandBuffer('ffmpeg', ['-v', 'error', '-i', file, '-vf',
    `select='${frames.map(n => `eq(n,${n})`).join('+')}',scale=${width}:${height}`, '-fps_mode', 'vfr',
    '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
}

function assertColor(data: Buffer, frame: number, expected: string, width = 54, height = 96) {
  // Upper left background, away from captions/cards' text.
  const offset = frame * width * height * 3 + (5 * width + 5) * 3;
  const rgb = [0, 1, 2].map(c => data[offset + c]);
  const target = [1, 3, 5].map(i => parseInt(expected.slice(i, i + 2), 16));
  assert.ok(rgb.every((x, c) => Math.abs(x - target[c]) < 20), `frame ${frame}: ${rgb} expected ${target}`);
}

async function pcm(file: string) {
  const raw = await runCommandBuffer('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0',
    '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1']);
  return Array.from({ length: raw.length / 4 }, (_, i) => raw.readFloatLE(i * 4));
}

function correlation(a: number[], b: number[], startSec: number, lengthSec: number) {
  let ab = 0, aa = 0, bb = 0;
  for (let i = Math.round(startSec * 16000); i < (startSec + lengthSec) * 16000; i++) {
    ab += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2;
  }
  return ab / Math.sqrt(aa * bb);
}

test('12s spoken narration: photos, looping B-roll, PNG counter card, kinetic captions, ducked music and SFX', { timeout }, async () => {
  const dir = await temp();
  try {
    const input = await fixture(dir, 5, 12_000);
    const files = ['red', 'green', 'blue', 'number', 'purple'];
    const list = path.join(dir, 'speech.txt');
    for (const name of files) await fs.copyFile(path.join(root, `${name}.wav`), path.join(dir, `${name}.wav`));
    await fs.writeFile(list, files.map(name => `file '${name}.wav'`).join('\n'));
    await runCommand('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, input.audioPath]);
    input.scenes.forEach((s, i) => { s.text = scripts[i]; });
    input.motionIntensity = 'subtle';
    await rasterizeGraphicCardSvg('<svg xmlns="http://www.w3.org/2000/svg" width="108" height="192"><rect width="108" height="192" fill="#e02020"/><circle cx="54" cy="60" r="12" fill="white"/></svg>', input.mediaById.get(input.scenes[0].imageId)!.path);
    input.scenes[3].beatKind = 'graphic-card';
    input.scenes[3].graphicCard = { cardType: 'stat-counter', theme: 'cream-poster',
      headline: scripts[3], statValue: '42', statUnit: 'BRIGHT IDEAS' };
    input.scenes[3].sfxCue = 'cashtick';
    const broll = path.join(dir, 'clip.mp4');
    await runCommand('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i',
      'color=c=0x2020e0:s=108x192:r=24:d=0.5', '-vf',
      'drawbox=x=25:y=75:w=12:h=12:color=white:t=fill,rotate=2*t:fillcolor=0x2020e0', '-c:v', 'libx264', broll]);
    input.mediaById.set(input.scenes[2].imageId, { path: broll, mediaType: 'video' });
    input.musicPath = path.join(dir, 'music.wav');
    await runCommand('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i',
      'sine=frequency=177:duration=1', input.musicPath]);
    input.backgroundMusic = { filename: 'music.wav', url: '', durationMs: 1000, volumeDb: -24, duckingEnabled: true };
    input.sfxConfig.volumeDb = -18;
    const states: string[] = [];
    input.onProgress = s => states.push(s.stage);
    const file = await renderProjectMp4(input);
    await validateRenderedMp4(file, 12_000, 360, 1080, 1920);
    assert.ok(!states.some(s => /repair|hard.cut/i.test(s)));
    assert.equal(states.at(-1), 'Export complete');
    const pixels = await rgbFrames(file, [45, 117, 189, 261, 333, 359]);
    assert.equal(pixels.length, 6 * 54 * 96 * 3);
    for (const i of [0, 1, 2, 4]) assertColor(pixels, i, COLORS[i]);
    assertColor(pixels, 5, COLORS[4]); // final shot is present through the last frame
    assertColor(pixels, 3, '#f9f5ed'); // PNG graphic-card background
    // Captions must actually be burned, not merely present in the ASS file.
    let light = 0;
    for (let y = 56; y < 75; y++) for (let x = 6; x < 48; x++) {
      const off = (y * 54 + x) * 3;
      if (pixels[off] > 150 && pixels[off + 1] > 100) light++;
    }
    assert.ok(light > 5, 'No visible burned caption pixels');
    const motion = await rgbFrames(file, [9, 51, 150, 156]);
    const bytesPerFrame = 54 * 96 * 3;
    // Compare the upper half, so caption changes cannot fake camera movement.
    assert.notDeepEqual(motion.subarray(0, bytesPerFrame / 2), motion.subarray(bytesPerFrame, bytesPerFrame * 1.5), 'photo camera movement froze');
    assert.notDeepEqual(motion.subarray(bytesPerFrame * 2, bytesPerFrame * 2.5), motion.subarray(bytesPerFrame * 3, bytesPerFrame * 3.5), 'B-roll froze');
    const original = await pcm(input.audioPath), mastered = await pcm(file);
    for (const start of [0.25, 5.05, 9.85]) {
      assert.ok(correlation(original, mastered, start, 0.5) > 0.9, `speech moved at ${start}s`);
    }
    assert.ok(mastered.every(Number.isFinite));
    assert.ok(mastered.reduce((peak, x) => Math.max(peak, Math.abs(x)), 0) < 1, 'master audio clips');
    assert.ok(!(await fs.readdir(dir)).some(n => n.startsWith('render_')));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

for (const style of ['cut', 'crossfade'] as const) {
  test(`${style}: fractional duration, short shots, exact positions, audio correlation from start to end`, { timeout }, async () => {
    const dir = await temp();
    try {
      const input = await fixture(dir, 5, 2201);
      input.transitionStyle = style;
      input.subtitlesEnabled = false; input.captionMode = 'off'; input.sfxConfig.enabled = false;
      const file = await renderProjectMp4(input);
      await validateRenderedMp4(file, 2201, 67, 1080, 1920);
      const frames = input.scenes.map(s => Math.round((s.startMs + s.endMs) / 2 * 30 / 1000));
      const rgb = await rgbFrames(file, frames);
      frames.forEach((_, i) => assertColor(rgb, i, COLORS[i]));
      const a = await pcm(input.audioPath), b = await pcm(file);
      for (const sec of [0.1, 1.0, 1.9]) assert.ok(correlation(a, b, sec, 0.2) > 0.99);
      if (style === 'crossfade') {
        const firstCut = Math.round(input.scenes[1].startMs * 30 / 1000);
        const fade = await rgbFrames(file, [firstCut + 2]);
        // A real blend of red and green; a hidden hard-cut fallback fails this.
        assert.ok(fade[(5 * 54 + 5) * 3] > 60);
        assert.ok(fade[(5 * 54 + 5) * 3 + 1] > 60);
      }
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
}

test('missing media, stale audio duration and invalid timelines reject without final MP4 or temporary files', { timeout }, async () => {
  const dir = await temp();
  try {
    const input = await fixture(dir, 2, 1000);
    const states: string[] = [];
    input.onProgress = s => states.push(s.status);
    input.scenes[1].imageId = 'missing';
    await assert.rejects(renderProjectMp4(input), /Media file missing for Beat 2/);
    assert.ok(!states.includes('completed'));
    assert.ok(!(await fs.readdir(dir)).some(n => n.startsWith('render_') || n.startsWith('scenesync_')));
    input.audioDurationMs = 1100;
    await assert.rejects(renderProjectMp4(input), /duration changed/);
    input.audioDurationMs = 1000;
    input.scenes[1].startMs += 200;
    await assert.rejects(renderProjectMp4(input), /Invalid timeline/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('unavailable AMF recovers to CPU while keeping the requested effects', { timeout }, async () => {
  const dir = await temp();
  try {
    const input = await fixture(dir, 2, 1400);
    input.encoderId = 'h264_amf'; input.transitionStyle = 'crossfade';
    const encoders: string[] = [];
    input.onProgress = s => encoders.push(s.encoderUsed);
    const file = await renderProjectMp4(input);
    await validateRenderedMp4(file, 1400, 42, 1080, 1920);
    // Hosted Linux/Windows runners have no AMD device. A real AMD PC may succeed.
    assert.ok(encoders.includes('libx264') || encoders.at(-1) === 'h264_amf');
    assert.ok(!(await fs.readdir(dir)).some(n => n.startsWith('render_')));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('audio stream duration wins over a longer uploaded video container', { timeout }, async () => {
  const dir = await temp();
  try {
    const file = path.join(dir, 'long video short voice.mp4');
    await runCommand('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=s=64x64:r=30:d=2',
      '-f', 'lavfi', '-i', 'sine=duration=1', '-c:v', 'libx264', '-c:a', 'aac', file]);
    assert.ok(Math.abs(await probeAudioDurationMs(file) - 1000) <= 1);
    await assert.rejects(validateRenderedMp4(file, 2000, 60, 64, 64), /audio track/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('sub-8-frame shots keep their intended positions instead of stretching the first image', { timeout }, async () => {
  const dir = await temp();
  try {
    const input = await fixture(dir, 3, 201);
    input.subtitlesEnabled = false; input.captionMode = 'off'; input.sfxConfig.enabled = false;
    const file = await renderProjectMp4(input);
    await validateRenderedMp4(file, 201, 7, 1080, 1920);
    const rgb = await rgbFrames(file, [0, 3, 6]);
    [0, 1, 2].forEach(i => assertColor(rgb, i, COLORS[i]));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('single-shot landscape statement card works with bottom-third caption mode', { timeout }, async () => {
  const dir = await temp();
  try {
    const input = await fixture(dir, 1, 734);
    input.aspectRatio = '16:9'; input.captionMode = 'bottom-third';
    input.scenes[0].beatKind = 'graphic-card';
    input.scenes[0].graphicCard = { cardType: 'statement', theme: 'noir-gold', headline: 'ONE COMPLETE SHOT' };
    const file = await renderProjectMp4(input);
    await validateRenderedMp4(file, 734, 23, 1920, 1080);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
