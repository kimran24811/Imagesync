import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { fixture } from './fixtures.ts';
import { renderProjectMp4 } from '../../server/services/videoRenderer.ts';
import { planMotion, estimateWords } from '../../src/director/planner.ts';
import { DIRECTOR_PRESETS } from '../../src/director/types.ts';
import { buildMotionSvg } from '../../src/director/composition.ts';
import { motionFontOptions } from '../../server/services/motionRenderer.ts';
import { runCommandBuffer } from '../../server/services/execUtils.ts';
import { validateRenderedMp4 } from '../../server/services/renderValidation.ts';
import { createMusicBed } from '../../server/services/musicBed.ts';

for (const preset of DIRECTOR_PRESETS) {
  test(
    `directed export: ${preset.name}, shared overlay pixels, sound and frame coverage`,
    { timeout: 180000 },
    async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "SceneSync motion O'Brien [test] "));
      try {
        const input = await fixture(dir, 2, 2400);
        input.scenes[0].text = '200,000 followers in 8 days';
        input.scenes[1].text = 'One idea changes everything';
        const alignment = {
          engine: 'estimated' as const,
          coverage: 0,
          words: estimateWords(input.scenes),
        };
        input.scenes = planMotion(input.scenes, preset.id, alignment).scenes;
        if (preset.id === 'educational') input.scenes[1].motion!.layout = 'chapter';
        input.musicPath = path.join(dir, 'bed.wav');
        await createMusicBed(input.musicPath, 2400, preset.id);
        input.backgroundMusic = {
          filename: 'original bed',
          url: '',
          durationMs: 2400,
          volumeDb: -20,
          duckingEnabled: true,
        };
        const file = await renderProjectMp4(input);
        await validateRenderedMp4(file, 2400, 72, 1080, 1920);
        // Decode the overlay region, checking actual export content rather than FFmpeg exit status.
        const rgb = await runCommandBuffer('ffmpeg', [
          '-v',
          'error',
          '-ss',
          '0.6',
          '-i',
          file,
          '-frames:v',
          '1',
          '-vf',
          'scale=108:192',
          '-pix_fmt',
          'rgb24',
          '-f',
          'rawvideo',
          'pipe:1',
        ]);
        assert.equal(rgb.length, 108 * 192 * 3);
        let lightPixels = 0;
        for (let y = 12; y < 70; y++)
          for (let x = 5; x < 103; x++) {
            const off = (y * 108 + x) * 3;
            if (rgb[off] > 130 && rgb[off + 1] > 100) lightPixels++;
          }
        assert.ok(lightPixels > 20, 'headline/counter/card is absent from exported pixels');
        const svg = buildMotionSvg(input.scenes[0], 600, '9:16', {
          width: 108,
          height: 192,
          captions: true,
        });
        assert.ok(svg.includes('200,000'));
        assert.ok(!/NaN|Infinity/.test(svg));
        const png = new Resvg(svg, { font: motionFontOptions() }).render().asPng();
        assert.ok(png.length > 1000, 'shared composition rasterizer produced no visible overlay');
        // The base image is visible in the unoccupied middle region.
        const off = (112 * 108 + 54) * 3;
        assert.ok(rgb[off] > 100 && rgb[off + 1] < 80 && rgb[off + 2] < 80);
        assert.ok(!(await fs.readdir(dir)).some((n) => n.startsWith('render_')));
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  );
}

test(
  'cancelling an active layered render cleans its partial output and never emits completed',
  { timeout: 120000 },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'SceneSync cancellation '));
    try {
      const input = await fixture(dir, 2, 5000),
        abort = new AbortController();
      let completed = false;
      input.scenes = planMotion(input.scenes, 'editorial-motion', {
        engine: 'estimated',
        coverage: 0,
        words: estimateWords(input.scenes),
      }).scenes;
      input.signal = abort.signal;
      input.onProgress = (s) => {
        if (s.stage.startsWith('Animating layers')) abort.abort();
        if (s.status === 'completed') completed = true;
      };
      await assert.rejects(renderProjectMp4(input), /cancelled/i);
      assert.equal(completed, false);
      assert.ok(
        !(await fs.readdir(dir)).some((n) => n.startsWith('render_') || n.startsWith('scenesync_'))
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
);

test(
  'full-range JPEG artwork is converted to limited-range H.264 before motion compositing',
  { timeout: 120000 },
  async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'SceneSync JPEG '));
    try {
      const input = await fixture(dir, 1, 1000),
        media = input.mediaById.get(input.scenes[0].imageId)!;
      const jpg = path.join(dir, 'actual artwork.jpg');
      const { runCommand } = await import('../../server/services/execUtils.ts');
      await runCommand('ffmpeg', [
        '-v',
        'error',
        '-y',
        '-i',
        media.path,
        '-frames:v',
        '1',
        '-pix_fmt',
        'yuvj420p',
        jpg,
      ]);
      media.path = jpg;
      input.motionIntensity = 'subtle';
      input.scenes = planMotion(input.scenes, 'editorial-motion', {
        engine: 'estimated',
        coverage: 0,
        words: estimateWords(input.scenes),
      }).scenes;
      const file = await renderProjectMp4(input);
      await validateRenderedMp4(file, 1000, 30, 1080, 1920);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
);

test('landscape layered layouts and spoken captions retain the full 1920x1080 frame',{timeout:120000},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'SceneSync landscape layers '));
  try{
    const input=await fixture(dir,1,1200);input.aspectRatio='16:9';input.scenes[0].text='One idea changes everything';
    input.scenes=planMotion(input.scenes,'educational',{engine:'estimated',coverage:0,words:estimateWords(input.scenes)}).scenes;
    input.scenes[0].motion!.layout='chapter';
    const file=await renderProjectMp4(input);await validateRenderedMp4(file,1200,36,1920,1080);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
