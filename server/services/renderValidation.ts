import { runCommand } from './execUtils.ts';
import { RENDER_FPS } from '../../src/utils/renderTimeline.ts';

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  duration?: string;
  start_time?: string;
  nb_read_frames?: string;
}

async function probe(file: string): Promise<ProbeStream[]> {
  const result = await runCommand('ffprobe', ['-v', 'error', '-count_frames',
    '-show_streams', '-of', 'json', file], 300_000);
  return (JSON.parse(result.stdout) as { streams?: ProbeStream[] }).streams ?? [];
}

export async function validateVideoSegment(file: string, frames: number, width: number, height: number): Promise<void> {
  const streams = await probe(file);
  const video = streams.find(s => s.codec_type === 'video');
  if (!video || Number(video.nb_read_frames) !== frames || video.width !== width ||
      video.height !== height || video.codec_name !== 'h264' || video.pix_fmt !== 'yuv420p' ||
      !Number.isFinite(Number(video.start_time)) || Math.abs(Number(video.start_time)) > 0.001 ||
      !Number.isFinite(Number(video.duration)) ||
      Math.abs(Number(video.duration) - frames / RENDER_FPS) > 0.002) {
    throw new Error(`Invalid rendered video (${file}): expected ${frames} H.264/yuv420p frames at ${width}×${height}, ${(frames / RENDER_FPS).toFixed(6)}s from zero; got ${video?.nb_read_frames ?? 'no video'} frames, ${video?.codec_name}/${video?.pix_fmt}, ${video?.width}×${video?.height}, duration ${video?.duration}s, start ${video?.start_time}s.`);
  }
}

export async function validateRenderedMp4(file: string, durationMs: number, frames: number, width: number, height: number): Promise<void> {
  await validateVideoSegment(file, frames, width, height);
  const streams = await probe(file);
  const audio = streams.find(s => s.codec_type === 'audio');
  // AAC packets are 1024 samples; permit one packet plus millisecond rounding.
  const audioToleranceSec = 1024 / 48000 + 0.002;
  if (!audio || audio.codec_name !== 'aac' || !Number.isFinite(Number(audio.duration)) ||
      Math.abs(Number(audio.duration) - durationMs / 1000) > audioToleranceSec ||
      !Number.isFinite(Number(audio.start_time)) || Math.abs(Number(audio.start_time)) > audioToleranceSec) {
    throw new Error('Export rejected: audio track is missing, shifted or does not cover the voiceover.');
  }
  // Probe metadata/exit code alone cannot detect a corrupted/truncated bitstream.
  await runCommand('ffmpeg', ['-v', 'error', '-xerror', '-i', file, '-map', '0:v:0',
    '-map', '0:a:0', '-f', 'null', '-'], 300_000);
}
