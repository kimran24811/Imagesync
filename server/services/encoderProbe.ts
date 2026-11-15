import type { EncoderOption } from '../../src/types/studio.ts';
import { runCommand } from './execUtils.ts';

interface EncoderCandidate {
  id: string;
  label: string;
  isHardware: boolean;
  vendor: string;
}

const CANDIDATES: EncoderCandidate[] = [
  { id: 'h264_nvenc', label: 'NVIDIA NVENC (H.264)', isHardware: true, vendor: 'NVIDIA' },
  { id: 'h264_qsv', label: 'Intel Quick Sync (H.264)', isHardware: true, vendor: 'Intel' },
  { id: 'h264_amf', label: 'AMD AMF (H.264)', isHardware: true, vendor: 'AMD' },
  { id: 'h264_videotoolbox', label: 'Apple VideoToolbox (H.264)', isHardware: true, vendor: 'Apple' },
  { id: 'libx264', label: 'CPU Software (libx264)', isHardware: false, vendor: 'CPU' },
];

let cachedProbeResult: {
  ffmpegVersion: string;
  availableEncoders: EncoderOption[];
  recommendedEncoder: EncoderOption;
} | null = null;

async function testEncoderWorks(encoderId: string): Promise<boolean> {
  try {
    await runCommand(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-f',
        'lavfi',
        '-i',
        'color=c=black:s=256x256:d=0.05',
        '-vframes',
        '1',
        '-pix_fmt',
        'yuv420p',
        '-c:v',
        encoderId,
        '-f',
        'null',
        '-',
      ],
      6000
    );
    return true;
  } catch {
    return false;
  }
}

export async function probeEncoders(): Promise<{
  ffmpegVersion: string;
  availableEncoders: EncoderOption[];
  recommendedEncoder: EncoderOption;
}> {
  if (cachedProbeResult) {
    return cachedProbeResult;
  }

  let ffmpegVersion = 'Unknown';
  try {
    const ver = await runCommand('ffmpeg', ['-version'], 4000);
    const firstLine = ver.stdout.split(/\r?\n/)[0] ?? '';
    const match = firstLine.match(/ffmpeg version\s+([^\s]+)/i);
    if (match) ffmpegVersion = match[1];
  } catch {
    ffmpegVersion = 'Unavailable';
  }

  const results = await Promise.all(
    CANDIDATES.map(async (candidate) => ({
      candidate,
      works: await testEncoderWorks(candidate.id),
    }))
  );

  const availableEncoders: EncoderOption[] = results
    .filter((r) => r.works)
    .map((r) => r.candidate);

  if (availableEncoders.length === 0) {
    availableEncoders.push(CANDIDATES[CANDIDATES.length - 1]);
  }

  const recommendedEncoder =
    availableEncoders.find((enc) => enc.isHardware) ?? availableEncoders[0];

  cachedProbeResult = {
    ffmpegVersion,
    availableEncoders,
    recommendedEncoder,
  };

  return cachedProbeResult;
}
