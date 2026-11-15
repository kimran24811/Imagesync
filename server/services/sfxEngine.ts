import fs from 'node:fs/promises';
import path from 'node:path';
import type { SceneItem, SfxConfig } from '../../src/types/studio.ts';
import {
  ALL_ACTIVE_SFX_CUES,
  DEFAULT_SFX_CONFIG,
  computeSfxSchedule,
  inferDefaultSfxCue,
  type ActiveSfxCue,
  type ScheduledSfxEvent,
} from '../../src/utils/sfxSchedule.ts';

export {
  ALL_ACTIVE_SFX_CUES,
  DEFAULT_SFX_CONFIG,
  inferDefaultSfxCue,
  type ActiveSfxCue,
  type ScheduledSfxEvent,
};

function writeMonoWav(samples: Float32Array, sampleRate = 44100): Buffer {
  const dataBytes = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataBytes);

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

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    buffer.writeInt16LE(Math.round(clamped * 32767), 44 + i * 2);
  }

  return buffer;
}

function makeRng(seedStart: number): () => number {
  let seed = seedStart >>> 0;
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 0xffffffff) * 2 - 1;
  };
}

/** 1. Fast swept whip-whoosh transition (~240ms) */
function synthesizeWhooshSamples(sampleRate = 44100): Float32Array {
  const len = Math.floor(sampleRate * 0.24);
  const out = new Float32Array(len);
  const nextNoise = makeRng(0x9e3779b9);

  let lp = 0;
  let bp = 0;
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const env = Math.sin(Math.PI * Math.pow(u, 0.72));
    const centerHz = 320 + 2350 * Math.sin(Math.PI * u);
    const f = Math.min(0.46, (2 * Math.PI * centerHz) / sampleRate);
    const hp = nextNoise() - lp - 0.52 * bp;
    bp += f * hp;
    lp += f * bp;
    out[i] = Math.tanh(bp * 2.4) * env * 0.58;
  }
  return out;
}

/** 2. Punchy modern UI/text pop transient (~85ms) */
function synthesizePopSamples(sampleRate = 44100): Float32Array {
  const len = Math.floor(sampleRate * 0.085);
  const out = new Float32Array(len);

  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const u = i / len;
    const freq = 980 * Math.exp(-u * 3.3) + 220;
    phase += (2 * Math.PI * freq) / sampleRate;
    const attack = Math.min(1, t / 0.0025);
    const decay = Math.exp(-u * 6.2);
    const click = i < 80 ? Math.sin(2 * Math.PI * 2600 * t) * (1 - i / 80) * 0.25 : 0;
    out[i] = (Math.sin(phase) * 0.72 + click) * attack * decay;
  }
  return out;
}

/** 3. Deep cinematic sub-bass hook impact (~580ms) */
function synthesizeImpactSamples(sampleRate = 44100): Float32Array {
  const len = Math.floor(sampleRate * 0.58);
  const out = new Float32Array(len);
  const nextNoise = makeRng(0x13579bdf);

  let phase = 0;
  let noiseLp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const freq = 36 + 135 * Math.exp(-t * 15);
    phase += (2 * Math.PI * freq) / sampleRate;
    const attack = Math.min(1, t / 0.004);
    const bodyEnv = Math.exp(-t * 5.2);
    const sub = Math.sin(phase) * 0.88 + Math.sin(phase * 2) * 0.18;
    noiseLp = noiseLp * 0.8 + nextNoise() * 0.2;
    const transient = noiseLp * Math.exp(-t * 28) * 0.62;
    out[i] = Math.tanh((sub * bodyEnv + transient) * 1.32) * attack * 0.86;
  }
  return out;
}

/** 4. Tension riser swell (~600ms) building upward into reveals */
function synthesizeRiserSamples(sampleRate = 44100): Float32Array {
  const len = Math.floor(sampleRate * 0.6);
  const out = new Float32Array(len);
  const nextNoise = makeRng(0x2468ace1);

  let phase = 0;
  let lp = 0;
  let bp = 0;
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const freq = 150 + 860 * Math.pow(u, 2.2);
    phase += (2 * Math.PI * freq) / sampleRate;
    const centerHz = 360 + 2800 * Math.pow(u, 1.8);
    const f = Math.min(0.46, (2 * Math.PI * centerHz) / sampleRate);
    const hp = nextNoise() - lp - 0.5 * bp;
    bp += f * hp;
    lp += f * bp;
    const env = Math.pow(u, 1.85) * (u > 0.94 ? (1 - u) / 0.06 : 1);
    out[i] = Math.tanh(Math.sin(phase) * 0.42 + bp * 1.65) * env * 0.66;
  }
  return out;
}

/** 5. Crisp digital glitch stutter (~170ms) */
function synthesizeGlitchSamples(sampleRate = 44100): Float32Array {
  const len = Math.floor(sampleRate * 0.17);
  const out = new Float32Array(len);
  const nextNoise = makeRng(0xdeadbeef);

  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const u = i / len;
    const gate = Math.floor(u * 9) % 2 === 0 ? 1 : 0.22;
    const fm = Math.sin(2 * Math.PI * (680 + 520 * Math.sin(2 * Math.PI * 60 * t)) * t);
    const env = Math.exp(-u * 4.4) * gate;
    out[i] = (fm * 0.5 + nextNoise() * 0.36) * env * 0.62;
  }
  return out;
}

/** 6. Clean insight chime ping (~420ms) */
function synthesizeChimeSamples(sampleRate = 44100): Float32Array {
  const len = Math.floor(sampleRate * 0.42);
  const out = new Float32Array(len);

  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 9.0);
    const tone =
      Math.sin(2 * Math.PI * 1046.5 * t) * 0.55 +
      Math.sin(2 * Math.PI * 1567.98 * t) * 0.32 +
      Math.sin(2 * Math.PI * 2093.0 * t) * 0.16;
    out[i] = tone * env * 0.58;
  }
  return out;
}

/** 7. Crisp single mechanical key / counter click (~38ms) */
function synthesizeTypeclickSamples(sampleRate = 44100): Float32Array {
  const len = Math.floor(sampleRate * 0.038);
  const out = new Float32Array(len);
  const nextNoise = makeRng(0x55aa55aa);

  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 120);
    const click = Math.sin(2 * Math.PI * 1850 * t) * 0.55 + nextNoise() * 0.45;
    out[i] = click * env * 0.44;
  }
  return out;
}

/** 8. Tight heavy thud hit (~145ms) for rapid statement cuts */
function synthesizeThudSamples(sampleRate = 44100): Float32Array {
  const len = Math.floor(sampleRate * 0.145);
  const out = new Float32Array(len);

  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    const freq = 56 + 150 * Math.exp(-t * 30);
    phase += (2 * Math.PI * freq) / sampleRate;
    const env = Math.min(1, t / 0.0025) * Math.exp(-t * 23);
    out[i] = Math.tanh(Math.sin(phase) * 1.48) * env * 0.8;
  }
  return out;
}

/** 9. Crisp DSLR / mechanical lens shutter snap (~90ms) */
function synthesizeShutterSamples(sampleRate = 44100): Float32Array {
  const len = Math.floor(sampleRate * 0.09);
  const out = new Float32Array(len);
  const nextNoise = makeRng(0x7c31f92a);

  const leaf2Start = Math.floor(sampleRate * 0.032);
  for (let i = 0; i < len; i++) {
    const t1 = i / sampleRate;
    const burst1 = Math.exp(-t1 * 185) * (nextNoise() * 0.65 + Math.sin(2 * Math.PI * 2900 * t1) * 0.35);
    let burst2 = 0;
    if (i >= leaf2Start) {
      const t2 = (i - leaf2Start) / sampleRate;
      burst2 = Math.exp(-t2 * 210) * (nextNoise() * 0.55 + Math.sin(2 * Math.PI * 3600 * t2) * 0.45) * 0.85;
    }
    out[i] = Math.tanh((burst1 + burst2) * 1.35) * 0.62;
  }
  return out;
}

/** 10. Rapid cash/stat counter ratchet burst (~320ms, 5 accelerating ticks) */
function synthesizeCashtickSamples(sampleRate = 44100): Float32Array {
  const len = Math.floor(sampleRate * 0.32);
  const out = new Float32Array(len);
  const hitOffsetsSec = [0, 0.048, 0.092, 0.132, 0.168, 0.215];
  const hitFreqs = [1320, 1480, 1660, 1860, 2093, 2637];

  for (let h = 0; h < hitOffsetsSec.length; h++) {
    const startIdx = Math.floor(hitOffsetsSec[h] * sampleRate);
    const freq = hitFreqs[h];
    const isFinal = h === hitOffsetsSec.length - 1;
    const dur = isFinal ? 0.095 : 0.036;
    const durSamples = Math.floor(dur * sampleRate);

    for (let j = 0; j < durSamples && startIdx + j < len; j++) {
      const t = j / sampleRate;
      const decay = isFinal ? Math.exp(-t * 32) : Math.exp(-t * 115);
      const val =
        (Math.sin(2 * Math.PI * freq * t) * 0.65 +
          Math.sin(2 * Math.PI * freq * 1.5 * t) * 0.3) *
        decay;
      out[startIdx + j] += val * (isFinal ? 0.45 : 0.34);
    }
  }
  return out;
}

/** 11. Staggered 3-tap mechanical keyboard typing burst (~190ms) */
function synthesizeKeyburstSamples(sampleRate = 44100): Float32Array {
  const len = Math.floor(sampleRate * 0.19);
  const out = new Float32Array(len);
  const nextNoise = makeRng(0x4141beef);
  const taps = [0, 0.052, 0.104];
  const pitches = [1750, 1980, 1640];

  for (let k = 0; k < taps.length; k++) {
    const startIdx = Math.floor(taps[k] * sampleRate);
    const tapSamples = Math.floor(0.032 * sampleRate);
    for (let j = 0; j < tapSamples && startIdx + j < len; j++) {
      const t = j / sampleRate;
      const env = Math.exp(-t * 135);
      const body = Math.sin(2 * Math.PI * pitches[k] * t) * 0.52 + nextNoise() * 0.48;
      out[startIdx + j] += body * env * 0.44;
    }
  }
  return out;
}

/** 12. Bright camera-flash high shimmer whoosh (~250ms) */
function synthesizeFlashwhooshSamples(sampleRate = 44100): Float32Array {
  const len = Math.floor(sampleRate * 0.25);
  const out = new Float32Array(len);
  const nextNoise = makeRng(0xfaceb00c);

  let lp = 0;
  let bp = 0;
  for (let i = 0; i < len; i++) {
    const u = i / len;
    const t = i / sampleRate;
    const centerHz = 1200 + 3200 * Math.pow(Math.sin(Math.PI * u), 1.4);
    const f = Math.min(0.47, (2 * Math.PI * centerHz) / sampleRate);
    const hp = nextNoise() - lp - 0.45 * bp;
    bp += f * hp;
    lp += f * bp;
    const env = Math.exp(-t * 8.5) * Math.min(1, t / 0.012);
    const shimmer = Math.sin(2 * Math.PI * 2200 * t) * Math.exp(-t * 24) * 0.22;
    out[i] = Math.tanh(bp * 2.2 + shimmer) * env * 0.56;
  }
  return out;
}

export async function ensureSfxBank(
  sfxDir: string
): Promise<Record<ActiveSfxCue, string>> {
  await fs.mkdir(sfxDir, { recursive: true });
  const paths: Record<ActiveSfxCue, string> = {
    impact: path.join(sfxDir, 'sfx_impact.wav'),
    whoosh: path.join(sfxDir, 'sfx_whoosh.wav'),
    pop: path.join(sfxDir, 'sfx_pop.wav'),
    riser: path.join(sfxDir, 'sfx_riser.wav'),
    glitch: path.join(sfxDir, 'sfx_glitch.wav'),
    chime: path.join(sfxDir, 'sfx_chime.wav'),
    typeclick: path.join(sfxDir, 'sfx_typeclick.wav'),
    thud: path.join(sfxDir, 'sfx_thud.wav'),
    shutter: path.join(sfxDir, 'sfx_shutter.wav'),
    cashtick: path.join(sfxDir, 'sfx_cashtick.wav'),
    keyburst: path.join(sfxDir, 'sfx_keyburst.wav'),
    flashwhoosh: path.join(sfxDir, 'sfx_flashwhoosh.wav'),
  };

  const builders: Array<[ActiveSfxCue, () => Float32Array]> = [
    ['impact', synthesizeImpactSamples],
    ['whoosh', synthesizeWhooshSamples],
    ['pop', synthesizePopSamples],
    ['riser', synthesizeRiserSamples],
    ['glitch', synthesizeGlitchSamples],
    ['chime', synthesizeChimeSamples],
    ['typeclick', synthesizeTypeclickSamples],
    ['thud', synthesizeThudSamples],
    ['shutter', synthesizeShutterSamples],
    ['cashtick', synthesizeCashtickSamples],
    ['keyburst', synthesizeKeyburstSamples],
    ['flashwhoosh', synthesizeFlashwhooshSamples],
  ];

  for (const [cue, build] of builders) {
    const target = paths[cue];
    try {
      const stat = await fs.stat(target);
      if (stat.size > 100) continue;
    } catch {
      // Generate below
    }
    const wav = writeMonoWav(build());
    await fs.writeFile(target, wav);
  }

  return paths;
}

export function buildSfxSchedule(
  scenes: SceneItem[],
  config: SfxConfig,
  audioDurationMs: number
): ScheduledSfxEvent[] {
  return computeSfxSchedule(scenes, config, audioDurationMs);
}
