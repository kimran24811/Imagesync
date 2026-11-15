import type { SpeechPause } from '../../src/types/studio.ts';
import { runCommand, runCommandBuffer } from './execUtils.ts';

export interface AudioAnalysisResult {
  durationMs: number;
  sampleRate: number;
  channels: number;
  codec: string;
  waveformPeaks: number[];
  pauses: SpeechPause[];
}

export async function probeAudioDurationMs(audioPath: string): Promise<number> {
  const probeRes = await runCommand('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    audioPath,
  ]);

  const parsed = JSON.parse(probeRes.stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string; duration?: string }>;
  };

  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');
  if (!audioStream) {
    throw new Error('The uploaded file does not contain a readable audio stream.');
  }

  const rawDurationSec = Number(audioStream.duration ?? parsed.format?.duration ?? 0);
  if (!Number.isFinite(rawDurationSec) || rawDurationSec <= 0.1) {
    throw new Error('Audio track duration is too short or unreadable.');
  }
  return Math.max(200, Math.round(rawDurationSec * 1000));
}

export async function createGeminiAudioProxy(
  audioPath: string,
  destMp3Path: string
): Promise<void> {
  // Compact 16kHz mono 32kbps MP3 (~240KB/min) preserves full speech timing for Gemini audio alignment
  await runCommand('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-i',
    audioPath,
    '-ac',
    '1',
    '-ar',
    '16000',
    '-b:a',
    '32k',
    '-f',
    'mp3',
    destMp3Path,
  ]);
}

export async function analyzeAudioTrack(audioPath: string): Promise<AudioAnalysisResult> {
  const probeRes = await runCommand('ffprobe', [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    audioPath,
  ]);

  const parsed = JSON.parse(probeRes.stdout) as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      codec_name?: string;
      sample_rate?: string;
      channels?: number;
      duration?: string;
    }>;
  };

  const audioStream = parsed.streams?.find((s) => s.codec_type === 'audio');
  if (!audioStream) {
    throw new Error('The uploaded file does not contain a readable audio stream.');
  }

  const rawDurationSec = Number(audioStream.duration ?? parsed.format?.duration ?? 0);
  if (!Number.isFinite(rawDurationSec) || rawDurationSec <= 0.1) {
    throw new Error('Audio track duration is too short or unreadable.');
  }

  const durationMs = Math.max(200, Math.round(rawDurationSec * 1000));
  const sampleRate = Number(audioStream.sample_rate ?? 44100) || 44100;
  const channels = audioStream.channels ?? 2;
  const codec = audioStream.codec_name ?? 'unknown';

  const pauses: SpeechPause[] = [];
  try {
    const silenceRes = await runCommand(
      'ffmpeg',
      [
        '-hide_banner',
        '-i',
        audioPath,
        '-af',
        'silencedetect=noise=-32dB:d=0.22',
        '-f',
        'null',
        '-',
      ],
      60000
    );

    const logText = `${silenceRes.stdout}\n${silenceRes.stderr}`;
    let currentStartSec: number | null = null;

    for (const line of logText.split(/\r?\n/)) {
      const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
      if (startMatch) {
        currentStartSec = parseFloat(startMatch[1]);
        continue;
      }
      const endMatch = line.match(/silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/);
      if (endMatch) {
        const endSec = parseFloat(endMatch[1]);
        const durSec = parseFloat(endMatch[2]);
        const startSec = currentStartSec ?? Math.max(0, endSec - durSec);
        const startMs = Math.round(startSec * 1000);
        const endMs = Math.min(durationMs, Math.round(endSec * 1000));
        const pauseDurationMs = Math.max(0, endMs - startMs);
        if (startMs > 250 && endMs < durationMs - 250 && pauseDurationMs >= 180) {
          pauses.push({
            startMs,
            endMs,
            durationMs: pauseDurationMs,
            midMs: Math.round((startMs + endMs) / 2),
          });
        }
        currentStartSec = null;
      }
    }
  } catch {
    // Non-fatal if silence detection returns nothing
  }

  const waveformPeaks = await extractWaveformPeaks(audioPath, 160);

  return {
    durationMs,
    sampleRate,
    channels,
    codec,
    waveformPeaks,
    pauses,
  };
}

async function extractWaveformPeaks(audioPath: string, bucketCount: number): Promise<number[]> {
  try {
    const pcm = await runCommandBuffer('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      audioPath,
      '-ac',
      '1',
      '-ar',
      '4000',
      '-f',
      's16le',
      'pipe:1',
    ]);

    const totalSamples = Math.floor(pcm.length / 2);
    if (totalSamples < bucketCount) {
      return Array.from({ length: bucketCount }, () => 0.35);
    }

    const samplesPerBucket = Math.floor(totalSamples / bucketCount);
    const peaks: number[] = [];
    let maxPeak = 1;

    for (let i = 0; i < bucketCount; i++) {
      const startSample = i * samplesPerBucket;
      const endSample = Math.min(totalSamples, startSample + samplesPerBucket);
      let peak = 0;
      for (let s = startSample; s < endSample; s += 2) {
        const val = Math.abs(pcm.readInt16LE(s * 2));
        if (val > peak) peak = val;
      }
      peaks.push(peak);
      if (peak > maxPeak) maxPeak = peak;
    }

    return peaks.map((p) => Number(Math.max(0.06, Math.min(1, p / maxPeak)).toFixed(3)));
  } catch {
    return Array.from({ length: bucketCount }, (_, i) =>
      Number((0.25 + 0.5 * Math.abs(Math.sin(i * 0.35))).toFixed(3))
    );
  }
}
