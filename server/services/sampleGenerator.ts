import fs from 'node:fs/promises';
import path from 'node:path';
import { runCommand } from './execUtils.ts';

export const SAMPLE_SCRIPT =
  'Subah jab maine apna laptop khola to analytics par zero views dekh kar dil toot gaya lekin phir mujhe apni purani script notebook aur mic yaad aaya jahan se maine naya safar shuru kiya aur phir gaon ke log chai par hans rahe thay jab unhone meri kahani suni aur aakhir mein pahadon ki choti par suraj nikalte dekh kar sab kuch badal gaya';

export interface SampleAssetFile {
  sourcePath: string;
  randomizedName: string;
}

export function getSampleImageAssets(): SampleAssetFile[] {
  const baseDir = path.resolve(process.cwd(), 'src/assets/images');
  return [
    {
      sourcePath: path.join(baseDir, 'sample_villagers_laughing_1794687284065.jpg'),
      randomizedName: 'IMG_8492.jpg',
    },
    {
      sourcePath: path.join(baseDir, 'sample_mountain_sunrise_1794687284666.jpg'),
      randomizedName: 'DSC_0147.jpg',
    },
    {
      sourcePath: path.join(baseDir, 'sample_analytics_zero_1794687284970.jpg'),
      randomizedName: 'photo_x92k.jpg',
    },
    {
      sourcePath: path.join(baseDir, 'sample_notebook_desk_1794687285469.jpg'),
      randomizedName: 'shot_b31.jpg',
    },
  ];
}

/**
 * Synthesizes a 14.4s cadence-aware WAV audio track with 4 distinct spoken-phrase envelopes
 * separated by genuine 450ms speech pauses so ffprobe, silencedetect, and live playback work cleanly.
 */
export async function generateSampleAudioWav(destPath: string): Promise<void> {
  const sampleRate = 44100;
  const durationSec = 14.4;
  const totalSamples = Math.floor(sampleRate * durationSec);
  const dataBytes = totalSamples * 2;
  const buffer = Buffer.alloc(44 + dataBytes);

  // Standard RIFF/WAVE header (PCM 16-bit mono 44.1kHz)
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataBytes, 40);

  // 4 spoken-phrase envelopes separated by 450ms natural silence pauses:
  const segments = [
    { start: 0.10, end: 3.20, freq: 220.0, cadenceHz: 3.5, amp: 0.24 },
    { start: 3.65, end: 6.90, freq: 261.63, cadenceHz: 4.0, amp: 0.26 },
    { start: 7.35, end: 10.70, freq: 293.66, cadenceHz: 3.2, amp: 0.25 },
    { start: 11.15, end: 14.30, freq: 329.63, cadenceHz: 2.8, amp: 0.27 },
  ];

  for (let i = 0; i < totalSamples; i++) {
    const t = i / sampleRate;
    let sample = 0;

    for (const seg of segments) {
      if (t >= seg.start && t <= seg.end) {
        const edgeFade = Math.min(
          1,
          (t - seg.start) / 0.08,
          (seg.end - t) / 0.08
        );
        const syllableMod = 0.62 + 0.38 * Math.sin(2 * Math.PI * seg.cadenceHz * t);
        const harmonic =
          Math.sin(2 * Math.PI * seg.freq * t) +
          0.35 * Math.sin(2 * Math.PI * seg.freq * 1.5 * t);
        sample = seg.amp * edgeFade * syllableMod * harmonic;
        break;
      }
    }

    const clamped = Math.max(-1, Math.min(1, sample));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }

  await fs.writeFile(destPath, buffer);
}

export async function copySampleImagesToDir(
  destDir: string
): Promise<Array<{ path: string; originalName: string }>> {
  const assets = getSampleImageAssets();
  const copied: Array<{ path: string; originalName: string }> = [];

  for (const item of assets) {
    try {
      await fs.access(item.sourcePath);
      const destPath = path.join(destDir, item.randomizedName);
      await fs.copyFile(item.sourcePath, destPath);
      copied.push({ path: destPath, originalName: item.randomizedName });
    } catch {
      // If an asset is missing, generate a clean colored fallback frame via ffmpeg
      const destPath = path.join(destDir, item.randomizedName);
      await runCommand('ffmpeg', [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-f',
        'lavfi',
        '-i',
        'color=c=#1E293B:s=1280x720:d=0.1',
        '-frames:v',
        '1',
        destPath,
      ]);
      copied.push({ path: destPath, originalName: item.randomizedName });
    }
  }

  return copied;
}
