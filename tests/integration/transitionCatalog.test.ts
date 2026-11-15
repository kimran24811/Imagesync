import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MOTION_TRANSITIONS } from '../../src/director/types.ts';
import { runCommand, runCommandBuffer } from '../../server/services/execUtils.ts';
import { validateVideoSegment } from '../../server/services/renderValidation.ts';

test(
  'every advertised transition encodes its complete incoming shot in real FFmpeg',
  { timeout: 180000 },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'SceneSync transition catalog '));
    try {
      for (const transition of MOTION_TRANSITIONS.filter((x) => x !== 'cut')) {
        const file = path.join(dir, `${transition}.mp4`);
        await runCommand('ffmpeg', [
          '-v',
          'error',
          '-y',
          '-filter_complex_threads',
          '1',
          '-f',
          'lavfi',
          '-i',
          'color=red:s=64x64:r=30:d=0.2',
          '-f',
          'lavfi',
          '-i',
          'color=blue:s=64x64:r=30:d=0.6',
          '-filter_complex',
          `[0:v]settb=AVTB[a];[1:v]settb=AVTB[b];[a][b]xfade=transition=${transition}:duration=0.2:offset=0[v]`,
          '-map',
          '[v]',
          '-frames:v',
          '18',
          '-r',
          '30',
          '-c:v',
          'libx264',
          '-pix_fmt',
          'yuv420p',
          file,
        ]);
        await validateVideoSegment(file, 18, 64, 64);
        const pixel = await runCommandBuffer('ffmpeg', [
          '-v',
          'error',
          '-ss',
          '0.5',
          '-i',
          file,
          '-frames:v',
          '1',
          '-vf',
          'scale=1:1',
          '-pix_fmt',
          'rgb24',
          '-f',
          'rawvideo',
          'pipe:1',
        ]);
        assert.ok(pixel[2] > 150 && pixel[0] < 80, `${transition} lost the incoming shot`);
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
);
