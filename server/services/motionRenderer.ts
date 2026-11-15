import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Resvg } from '@resvg/resvg-js';
import type { AspectRatio, SceneItem } from '../../src/types/studio.ts';
import { buildMotionSvg } from '../../src/director/composition.ts';

export const motionFontOptions = () => ({
  loadSystemFonts: false,
  defaultFontFamily: 'DejaVu Sans',
  fontFiles: [
    fileURLToPath(new URL('../../public/fonts/SceneSyncSans-Regular.ttf', import.meta.url)),
    fileURLToPath(new URL('../../public/fonts/SceneSyncSans-Bold.ttf', import.meta.url)),
  ],
});
export async function renderMotionLayer(params: {
  scene: SceneItem;
  aspect: AspectRatio;
  frames: number;
  inputPath: string;
  outputPath: string;
  encoderArgs: string[];
  captions: boolean;
  brand: string;
  signal?: AbortSignal;
}): Promise<void> {
  const { scene, aspect, frames } = params;
  if (params.signal?.aborted) throw new Error('Render cancelled.');
  const child = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-filter_complex_threads',
      '1',
      '-i',
      params.inputPath,
      '-f',
      'image2pipe',
      '-framerate',
      '30',
      '-c:v',
      'png',
      '-i',
      'pipe:0',
      '-filter_complex',
      '[1:v]format=rgba[ov];[0:v][ov]overlay=0:0:shortest=1:format=auto,format=yuv420p[v]',
      '-map',
      '[v]',
      '-frames:v',
      String(frames),
      '-r',
      '30',
      '-an',
      ...params.encoderArgs,
      '-movflags',
      '+faststart',
      params.outputPath,
    ],
    { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] }
  );
  let diagnostics = '',
    pipeError: Error | undefined;
  child.stderr.on('data', (chunk) => {
    diagnostics = (diagnostics + chunk.toString()).slice(-6000);
  });
  child.stdin.on('error', (error) => {
    pipeError = error;
  });
  const finish = new Promise<Error | undefined>((resolve) => {
    child.once('error', (error) =>
      resolve(new Error(`Cannot start motion renderer: ${error.message}`))
    );
    child.once('close', (code) =>
      resolve(
        code === 0 ? undefined : new Error(`Motion compositor failed (${code}): ${diagnostics}`)
      )
    );
  });
  let aborted = false;
  const abort = () => {
    aborted = true;
    child.kill();
  };
  params.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 20 * 60_000);
  try {
    for (let frame = 0; frame < frames; frame++) {
      if (aborted) throw new Error('Motion render cancelled or timed out.');
      if (pipeError) break;
      // Absolute frame time agrees with the global captions/SFX timebase.
      const now = scene.startMs + (frame * 1000) / 30;
      const svg = buildMotionSvg(scene, now, aspect, {
        captions: params.captions,
        brand: params.brand,
      });
      const png = new Resvg(svg, { font: motionFontOptions() }).render().asPng();
      if (!child.stdin.write(png)) {
        await Promise.race([
          once(child.stdin, 'drain'),
          finish.then((error) => {
            if (error) throw error;
          }),
        ]);
      }
    }
    child.stdin.end();
    const error = await finish;
    if (error) throw error;
    if (pipeError) throw pipeError;
  } catch (error) {
    child.kill();
    await finish;
    throw error;
  } finally {
    clearTimeout(timer);
    params.signal?.removeEventListener('abort', abort);
  }
}
