import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { SceneItem } from '../src/types/studio.ts';
import {
  rasterizeGraphicCardSvg,
  renderGraphicCardSegmentMp4,
} from '../server/services/cardRenderer.ts';

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const scene = (cardType: 'statement' | 'stat-counter'): SceneItem => ({
  id: 'card_smoke', index: 0, startMs: 0, endMs: 750, durationMs: 750,
  text: 'THE IDEA', imageId: 'image_1',
  matchReason: 'test', emotionalWeight: 1,
  kenBurnsDirection: 'snap-zoom-in', snappedToPause: false,
  alignmentSource: 'estimated', beatKind: 'graphic-card',
  graphicCard: {
    cardType, theme: 'cream-poster',
    headline: 'THE IDEA',
    kicker: 'A CROW',
    ...(cardType === 'stat-counter' ? {statValue: '42', statUnit: 'PEBBLES'} : {}),
  },
});

test('graphic-card SVG is rasterized to an actual PNG without an FFmpeg SVG decoder', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scenesync-png-'));
  try {
    const pngPath = path.join(dir, 'graphic card.png');
    await rasterizeGraphicCardSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#f59e0b"/><text x="15" y="60" font-size="24">Test</text></svg>',
      pngPath
    );
    const data = await fs.readFile(pngPath);
    assert.ok(data.subarray(0,8).equals(pngSignature));
    assert.equal(data.readUInt32BE(16), 320);
    assert.equal(data.readUInt32BE(20), 180);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

let ffmpegAvailable = false;
try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore', timeout: 5000 });
  ffmpegAvailable = true;
} catch {
  // GitHub CI and Windows install FFmpeg; a JS-only dev environment may not.
}

test('FFmpeg encodes 1080p statement and animated counter card PNG segments', {
  skip: !ffmpegAvailable && 'FFmpeg is not installed',
  timeout: 120000,
}, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scenesync-card-'));
  try {
    for (const [cardType, frames] of [
      ['statement', 10],
      ['stat-counter', 18],
    ] as const) {
      const segPath = path.join(dir, cardType + '.mp4');
      await renderGraphicCardSegmentMp4({
        scene: scene(cardType),
        aspectRatio: '9:16',
        accentColor: 'gold',
        frames,
        renderDir: dir,
        segPath,
        encoderArgs: ['-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p'],
      });
      const stat = await fs.stat(segPath);
      assert.ok(stat.size > 1000, cardType + ' video is too small');
      const pngInputs = (await fs.readdir(dir)).filter((name) => name.endsWith('.png'));
      assert.ok(pngInputs.length > 0, cardType + ' did not generate PNG assets');
      assert.equal((await fs.readdir(dir)).filter((name) => name.endsWith('.svg')).length, 0);
    }
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
