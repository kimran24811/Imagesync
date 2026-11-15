import path from 'node:path';
import type { MediaType } from '../../src/types/studio.ts';
import { runCommand } from './execUtils.ts';

export interface ProcessedMediaMeta {
  mediaType: MediaType;
  clipDurationMs?: number;
  width: number;
  height: number;
  thumbPath: string;
}

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v']);

export async function processUploadedMedia(
  sourcePath: string,
  thumbsDir: string,
  mediaId: string,
  originalName: string
): Promise<ProcessedMediaMeta> {
  const thumbPath = path.join(thumbsDir, `${mediaId}.jpg`);
  const ext = path.extname(originalName).toLowerCase();
  const isVideoExt = VIDEO_EXTENSIONS.has(ext);

  let width = 1920;
  let height = 1080;
  let clipDurationMs: number | undefined;
  let mediaType: MediaType = isVideoExt ? 'video' : 'image';

  try {
    const probe = await runCommand('ffprobe', [
      '-v',
      'quiet',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      sourcePath,
    ]);
    const parsed = JSON.parse(probe.stdout) as {
      format?: { duration?: string; format_name?: string };
      streams?: Array<{
        codec_type?: string;
        width?: number;
        height?: number;
        duration?: string;
        nb_frames?: string;
      }>;
    };

    const vStream = parsed.streams?.find((s) => s.codec_type === 'video') ?? parsed.streams?.[0];
    if (vStream?.width && vStream?.height) {
      width = vStream.width;
      height = vStream.height;
    }

    const rawDurSec = Number(vStream?.duration ?? parsed.format?.duration ?? 0);
    const nbFrames = Number(vStream?.nb_frames ?? 0);

    if (isVideoExt || (Number.isFinite(rawDurSec) && rawDurSec > 0.25 && nbFrames !== 1)) {
      mediaType = 'video';
      if (Number.isFinite(rawDurSec) && rawDurSec > 0.1) {
        clipDurationMs = Math.round(rawDurSec * 1000);
      }
    }
  } catch {
    // Keep sensible fallback dimensions
  }

  // Extract a crisp 512px JPEG thumbnail (for B-roll video clips, seek 30% in up to 1.0s)
  const seekSec =
    mediaType === 'video' && clipDurationMs
      ? Math.min(1.0, Math.max(0, (clipDurationMs / 1000) * 0.3)).toFixed(2)
      : '0';

  const thumbArgs =
    mediaType === 'video'
      ? [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-ss',
          seekSec,
          '-i',
          sourcePath,
          '-vf',
          "scale='min(512,iw)':-2",
          '-q:v',
          '4',
          '-frames:v',
          '1',
          thumbPath,
        ]
      : [
          '-hide_banner',
          '-loglevel',
          'error',
          '-y',
          '-i',
          sourcePath,
          '-vf',
          "scale='min(512,iw)':-2",
          '-q:v',
          '4',
          '-frames:v',
          '1',
          thumbPath,
        ];

  await runCommand('ffmpeg', thumbArgs);

  return {
    mediaType,
    clipDurationMs,
    width,
    height,
    thumbPath,
  };
}
