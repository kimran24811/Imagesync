import fs from 'node:fs/promises';
import type { DirectorPresetId } from '../../src/director/types.ts';

/** Quiet, original procedural underscore; no remote music service or copyrighted track. */
export async function createMusicBed(
  file: string,
  durationMs: number,
  preset: DirectorPresetId
): Promise<void> {
  const sr = 24000,
    count = Math.ceil((durationMs * sr) / 1000),
    buffer = Buffer.alloc(44 + count * 2);
  // The caller uses a version/preset-specific filename. Reuse immutable beds so
  // changing a queued project's preset cannot truncate a render's open audio file.
  try {const stat=await fs.stat(file);if(stat.size===44+count*2)return;} catch {}
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + count * 2, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sr, 24);
  buffer.writeUInt32LE(sr * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(count * 2, 40);
  const bpm = preset === 'cinematic-story' ? 72 : preset === 'rapid-viral' ? 116 : 96,
    beat = 60 / bpm;
  const chords = [
    [130.813, 164.814, 195.998],
    [110, 130.813, 164.814],
    [87.307, 110, 130.813],
    [97.999, 123.471, 146.832],
  ];
  for (let i = 0; i < count; i++) {
    const t = i / sr,
      bar = beat * 4,
      chord = chords[Math.floor(t / bar) % 4],
      phase = t % bar;
    const envelope = Math.min(1, phase / 0.08, (bar - phase) / 0.3),
      fade = Math.min(1, t / 1.2, (durationMs / 1000 - t) / 1.8);
    let value = 0;
    for (const f of chord)
      value +=
        (Math.sin(2 * Math.PI * f * t) + 0.22 * Math.sin(2 * Math.PI * f * 2 * t)) *
        0.055 *
        envelope;
    if (preset !== 'cinematic-story') {
      const pulse = t % beat;
      value +=
        Math.sin(2 * Math.PI * (48 * pulse + 2.5 * (1 - Math.exp(-pulse * 25)))) *
        Math.exp(-pulse * 20) *
        0.09;
      const arp = chord[Math.floor(t / (beat / 2)) % 3] * 2,
        pluck = t % (beat / 2);
      value += Math.sin(2 * Math.PI * arp * t) * Math.exp(-pluck * 13) * 0.035;
    }
    buffer.writeInt16LE(
      Math.round(Math.max(-0.8, Math.min(0.8, value * fade)) * 32767),
      44 + i * 2
    );
  }
  await fs.writeFile(file, buffer);
}
