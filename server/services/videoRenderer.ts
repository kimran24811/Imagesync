import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AccentColorId,
  AspectRatio,
  BackgroundMusicTrack,
  CaptionMode,
  FocalCropRegion,
  FontStyleId,
  KenBurnsDirection,
  MediaType,
  MotionIntensity,
  RenderJobState,
  SceneItem,
  SfxConfig,
  TextEffectId,
  TransitionStyle,
} from '../../src/types/studio.ts';
import { renderGraphicCardSegmentMp4 } from './cardRenderer.ts';
import { spawnStreamCommand } from './execUtils.ts';
import {
  buildSfxSchedule,
  ensureSfxBank,
  type ActiveSfxCue,
} from './sfxEngine.ts';
import { writeAssSubtitleFile } from './subtitleGenerator.ts';
import { planDirectorTransitions } from '../../src/utils/directorTransitions.ts';

export interface RenderProjectInput {
  jobId: string;
  projectId: string;
  projectDir: string;
  sfxDir: string;
  audioPath: string;
  audioDurationMs: number;
  musicPath?: string;
  backgroundMusic?: BackgroundMusicTrack;
  aspectRatio: AspectRatio;
  motionIntensity: MotionIntensity;
  transitionStyle: TransitionStyle;
  transitionDurationMs: number;
  subtitlesEnabled: boolean;
  captionMode: CaptionMode;
  textEffect: TextEffectId;
  fontStyle: FontStyleId;
  accentColor: AccentColorId;
  brandKicker: string;
  sfxConfig: SfxConfig;
  encoderId: string;
  scenes: SceneItem[];
  mediaById: Map<string, { path: string; mediaType: MediaType }>;
  onProgress: (state: RenderJobState) => void;
}

function getTargetDimensions(aspectRatio: AspectRatio): { width: number; height: number } {
  if (aspectRatio === '9:16') {
    return { width: 1080, height: 1920 };
  }
  return { width: 1920, height: 1080 };
}

function getFocalAnchorParams(crop: FocalCropRegion | undefined): {
  baseZoom: number;
  cxRatio: number;
  cyRatio: number;
} {
  switch (crop) {
    case 'left-focus':
      return { baseZoom: 1.36, cxRatio: 0.30, cyRatio: 0.48 };
    case 'right-focus':
      return { baseZoom: 1.36, cxRatio: 0.70, cyRatio: 0.48 };
    case 'top-hero':
      return { baseZoom: 1.32, cxRatio: 0.50, cyRatio: 0.32 };
    case 'bottom-detail':
      return { baseZoom: 1.32, cxRatio: 0.50, cyRatio: 0.68 };
    case 'tight-macro':
      return { baseZoom: 1.48, cxRatio: 0.50, cyRatio: 0.46 };
    default:
      return { baseZoom: 1.0, cxRatio: 0.50, cyRatio: 0.50 };
  }
}

function buildPhotoVideoFilter(
  width: number,
  height: number,
  frames: number,
  direction: KenBurnsDirection,
  motionIntensity: MotionIntensity,
  focalCrop?: FocalCropRegion
): string {
  const fps = 30;
  const { baseZoom, cxRatio, cyRatio } = getFocalAnchorParams(focalCrop);

  if (motionIntensity === 'none' && (!focalCrop || focalCrop === 'full')) {
    return `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps},format=yuv420p`;
  }

  // 2.2x canvas preserves crisp 1080p edges even when focal sub-cropping 1.48x + snap zooming!
  const upW = Math.round(width * 2.2);
  const upH = Math.round(height * 2.2);
  const denom = Math.max(1, frames - 1);
  const amp = motionIntensity === 'moderate' ? 1.25 : 0.9;

  let zoomExpr = `${baseZoom}`;
  let xExpr = `max(0,min(iw-iw/zoom,iw*${cxRatio}-(iw/zoom/2)))`;
  let yExpr = `max(0,min(ih-ih/zoom,ih*${cyRatio}-(ih/zoom/2)))`;

  if (motionIntensity !== 'none') {
    const zDelta = Number((0.14 * amp).toFixed(4));
    switch (direction) {
      case 'snap-zoom-in':
        zoomExpr = `${(baseZoom + 0.04).toFixed(3)}+${(0.24 * amp).toFixed(3)}*exp(-on/3.2)+0.06*on/${denom}`;
        break;
      case 'whip-zoom':
        zoomExpr = `${baseZoom.toFixed(3)}+${(0.24 * amp).toFixed(3)}*(1-exp(-on/4.5))`;
        break;
      case 'impact-shake':
        zoomExpr = `${(baseZoom + 0.06).toFixed(3)}+${(0.14 * amp).toFixed(3)}*exp(-on/3.8)`;
        xExpr = `max(0,min(iw-iw/zoom,iw*${cxRatio}-(iw/zoom/2)+if(lt(on,7),sin(on*2.3)*${Math.round(28 * amp)}*exp(-on/2.2),0)))`;
        yExpr = `max(0,min(ih-ih/zoom,ih*${cyRatio}-(ih/zoom/2)+if(lt(on,7),cos(on*2.7)*${Math.round(20 * amp)}*exp(-on/2.2),0)))`;
        break;
      case 'zoom-in':
        zoomExpr = `${baseZoom.toFixed(3)}+${zDelta}*on/${denom}`;
        break;
      case 'zoom-out':
        zoomExpr = `${(baseZoom + zDelta).toFixed(3)}-${zDelta}*on/${denom}`;
        break;
      case 'pan-left':
        zoomExpr = `${Math.max(1.16, baseZoom + 0.12).toFixed(3)}`;
        xExpr = `max(0,min(iw-iw/zoom,(iw-iw/zoom)*(${Math.max(0.2, cxRatio - 0.15).toFixed(2)}+0.30*(1-on/${denom}))))`;
        break;
      case 'pan-right':
        zoomExpr = `${Math.max(1.16, baseZoom + 0.12).toFixed(3)}`;
        xExpr = `max(0,min(iw-iw/zoom,(iw-iw/zoom)*(${Math.max(0.2, cxRatio - 0.15).toFixed(2)}+0.30*(on/${denom}))))`;
        break;
      case 'pan-up':
        zoomExpr = `${Math.max(1.18, baseZoom + 0.12).toFixed(3)}`;
        yExpr = `max(0,min(ih-ih/zoom,(ih-ih/zoom)*(${Math.max(0.2, cyRatio - 0.12).toFixed(2)}+0.24*(1-on/${denom}))))`;
        break;
    }
  }

  return [
    `scale=${upW}:${upH}:force_original_aspect_ratio=increase`,
    `crop=${upW}:${upH}`,
    'setsar=1',
    `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${width}x${height}:fps=${fps}`,
    'format=yuv420p',
  ].join(',');
}

function buildBrollVideoFilter(width: number, height: number): string {
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    'setsar=1',
    'fps=30',
    'format=yuv420p',
  ].join(',');
}

function buildEncoderArgs(encoderId: string): string[] {
  switch (encoderId) {
    case 'h264_nvenc':
      return ['-c:v', 'h264_nvenc', '-preset', 'p4', '-cq', '20', '-pix_fmt', 'yuv420p'];
    case 'h264_qsv':
      return ['-c:v', 'h264_qsv', '-preset', 'medium', '-global_quality', '21', '-pix_fmt', 'yuv420p'];
    case 'h264_amf':
      return ['-c:v', 'h264_amf', '-quality', 'balanced', '-pix_fmt', 'yuv420p'];
    case 'h264_videotoolbox':
      return ['-c:v', 'h264_videotoolbox', '-q:v', '65', '-pix_fmt', 'yuv420p'];
    default:
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p'];
  }
}

function escapeFilterPath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}

export async function renderProjectMp4(input: RenderProjectInput): Promise<string> {
  const startedAt = Date.now();
  const { width, height } = getTargetDimensions(input.aspectRatio);
  const fps = 30;
  const totalScenes = input.scenes.length;

  const isTransitionActive = input.transitionStyle !== 'cut' && totalScenes > 1;

  const sceneFrameCounts = input.scenes.map((scene) => {
    const startF = Math.round((scene.startMs * fps) / 1000);
    const endF = Math.round((scene.endMs * fps) / 1000);
    return Math.max(8, endF - startF);
  });

  const directorBoundaries = isTransitionActive
    ? planDirectorTransitions(input.scenes, sceneFrameCounts, input.transitionStyle, input.transitionDurationMs, fps)
    : [];
  const useXfade = directorBoundaries.length === totalScenes - 1 && totalScenes > 1;
  const snapCount = directorBoundaries.filter((x) => x.kind === 'snap').length;
  const accentCount = directorBoundaries.length - snapCount;

  const effectiveCaptionMode: CaptionMode =
    !input.subtitlesEnabled || input.captionMode === 'off'
      ? 'off'
      : input.captionMode || 'explainer-kinetic';

  const renderDir = path.join(input.projectDir, 'render_' + input.jobId);
  await fs.mkdir(renderDir, { recursive: true });

  try {
  const outputPath = path.join(input.projectDir, `scenesync_${input.projectId}_${input.jobId}.mp4`);
  const segmentPaths: string[] = [];
  let activeEncoder = input.encoderId || 'libx264';

  const emit = (partial: Partial<RenderJobState>) => {
    input.onProgress({
      jobId: input.jobId,
      projectId: input.projectId,
      status: 'rendering',
      progress: 0,
      currentScene: 0,
      totalScenes,
      stage: 'Preparing scenes',
      message: 'Initializing FFmpeg render pipeline...',
      encoderUsed: activeEncoder,
      elapsedMs: Date.now() - startedAt,
      ...partial,
    });
  };

  emit({
    status: 'rendering',
    progress: 3,
    stage: 'Preparing rapid micro-beat pipeline',
    message: `Target ${width}×${height} @ ${fps}fps · ${totalScenes} visual beats · ${useXfade ? `${snapCount} snap cuts + ${accentCount} accent transitions` : 'Hard cuts'}`,
  });

  // 1. Render every micro-beat segment (Media, Focal Crop-Cut, or $0 Graphic Card)
  for (let i = 0; i < totalScenes; i++) {
    const scene = input.scenes[i];
    const baseFrames = sceneFrameCounts[i];
    const extraFrames = useXfade ? (directorBoundaries[i]?.overlapFrames ?? 0) : 0;
    const totalSegFrames = baseFrames + extraFrames;
    const durationSec = (totalSegFrames / fps).toFixed(4);

    const segPath = path.join(renderDir, `seg_${String(i).padStart(4, '0')}.mp4`);
    const progressPct = Math.round(5 + ((i + 0.2) / totalScenes) * 68);

    emit({
      status: 'rendering',
      progress: progressPct,
      currentScene: i + 1,
      stage: `Rendering beat ${i + 1} of ${totalScenes}`,
      message:
        scene.beatKind === 'graphic-card'
          ? `Compositing animated ${scene.graphicCard?.cardType || 'statement'} graphic card (${(scene.durationMs / 1000).toFixed(2)}s)`
          : `${scene.beatKind === 'crop-cut' ? `Sub-crop [${scene.focalCrop}] + ` : ''}${scene.kenBurnsDirection} (${(scene.durationMs / 1000).toFixed(2)}s)`,
    });

    if (scene.beatKind === 'graphic-card') {
      const renderCard = async (enc: string) => {
        await renderGraphicCardSegmentMp4({
          scene,
          aspectRatio: input.aspectRatio,
          accentColor: input.accentColor,
          frames: totalSegFrames,
          renderDir,
          segPath,
          encoderArgs: buildEncoderArgs(enc),
        });
      };
      try {
        await renderCard(activeEncoder);
      } catch (err) {
        if (activeEncoder !== 'libx264') {
          activeEncoder = 'libx264';
          await renderCard('libx264');
        } else {
          throw err;
        }
      }
      segmentPaths.push(segPath);
      continue;
    }

    const media = input.mediaById.get(scene.imageId);
    if (!media) {
      throw new Error(`Media file missing for Beat ${i + 1}`);
    }

    let baseArgs: string[];
    if (media.mediaType === 'video') {
      baseArgs = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-stream_loop',
        '-1',
        '-i',
        media.path,
        '-t',
        durationSec,
        '-vf',
        buildBrollVideoFilter(width, height),
        '-frames:v',
        String(totalSegFrames),
        '-r',
        String(fps),
      ];
    } else if (input.motionIntensity === 'none' && (!scene.focalCrop || scene.focalCrop === 'full')) {
      baseArgs = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-loop',
        '1',
        '-i',
        media.path,
        '-t',
        durationSec,
        '-vf',
        buildPhotoVideoFilter(width, height, totalSegFrames, scene.kenBurnsDirection, 'none', scene.focalCrop),
        '-r',
        String(fps),
      ];
    } else {
      baseArgs = [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        media.path,
        '-vf',
        buildPhotoVideoFilter(
          width,
          height,
          totalSegFrames,
          scene.kenBurnsDirection,
          input.motionIntensity,
          scene.focalCrop
        ),
        '-frames:v',
        String(totalSegFrames),
        '-r',
        String(fps),
      ];
    }

    const encodeSegment = async (enc: string) => {
      await spawnStreamCommand('ffmpeg', [
        ...baseArgs,
        ...buildEncoderArgs(enc),
        '-an',
        '-movflags',
        '+faststart',
        segPath,
      ]);
    };

    try {
      await encodeSegment(activeEncoder);
    } catch (err) {
      if (activeEncoder !== 'libx264') {
        activeEncoder = 'libx264';
        emit({
          status: 'rendering',
          progress: progressPct,
          currentScene: i + 1,
          encoderUsed: activeEncoder,
          stage: `Switching to CPU fallback (${activeEncoder})`,
          message: `Hardware encoder unavailable; continuing beat ${i + 1} with libx264`,
        });
        await encodeSegment('libx264');
      } else {
        throw err;
      }
    }

    segmentPaths.push(segPath);
  }

  // 2. Generate mixed-scale kinetic ASS overlay
  let assPath: string | null = null;
  if (effectiveCaptionMode !== 'off') {
    assPath = path.join(renderDir, 'subtitles.ass');
    await writeAssSubtitleFile(assPath, input.scenes, input.aspectRatio, {
      captionMode: effectiveCaptionMode,
      textEffect: input.textEffect,
      fontStyle: input.fontStyle,
      accentColor: input.accentColor,
      brandKicker: input.brandKicker,
    });
  }

  // 3. Build dense 12-cue SFX schedule
  const sfxEvents = buildSfxSchedule(input.scenes, input.sfxConfig, input.audioDurationMs);
  const hasSfx = sfxEvents.length > 0;
  const hasMusic = Boolean(input.musicPath && input.backgroundMusic);

  emit({
    status: 'muxing',
    progress: 78,
    currentScene: totalScenes,
    stage: 'Mastering whip transitions, mixed typography & dense SFX',
    message: `${useXfade ? `Compositing ${input.transitionStyle} transitions` : 'Joining crisp cuts'}${assPath ? ` + burning ${effectiveCaptionMode} typography` : ''}${hasSfx ? ` + mixing ${sfxEvents.length} SFX cues` : ''}${hasMusic ? ' + auto-ducking music' : ''}...`,
  });

  const exactAudioSec = (input.audioDurationMs / 1000).toFixed(3);
  const needsVideoFilterPass = useXfade || Boolean(assPath);

  if (!needsVideoFilterPass && !hasMusic && !hasSfx) {
    const concatListPath = path.join(renderDir, 'concat.txt');
    const concatContent = segmentPaths
      .map((p) => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
      .join('\n');
    await fs.writeFile(concatListPath, concatContent, 'utf8');

    await spawnStreamCommand('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concatListPath,
      '-i',
      input.audioPath,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-t',
      exactAudioSec,
      '-movflags',
      '+faststart',
      outputPath,
    ]);
  } else {
    const masterArgs: string[] = ['-hide_banner', '-loglevel', 'error', '-y'];
    const filterLines: string[] = [];

    for (const seg of segmentPaths) {
      masterArgs.push('-i', seg);
    }

    const voiceInputIdx = segmentPaths.length;
    masterArgs.push('-i', input.audioPath);

    let nextInputIdx = voiceInputIdx + 1;
    let musicInputIdx = -1;
    if (hasMusic && input.musicPath) {
      musicInputIdx = nextInputIdx++;
      masterArgs.push('-stream_loop', '-1', '-i', input.musicPath);
    }

    const sfxInputIndices = new Map<ActiveSfxCue, number>();
    if (hasSfx) {
      const sfxBank = await ensureSfxBank(input.sfxDir);
      const uniqueCues = Array.from(new Set(sfxEvents.map((e) => e.cue)));
      for (const cue of uniqueCues) {
        sfxInputIndices.set(cue, nextInputIdx++);
        masterArgs.push('-i', sfxBank[cue]);
      }
    }

    // Video filtergraph with exact frame-locked xfade chain
    let videoOutLabel = '0:v';
    if (useXfade && segmentPaths.length > 1) {
      let currentLabel = '0:v';
      let cumFrames = sceneFrameCounts[0];
      for (let i = 1; i < segmentPaths.length; i++) {
        const offsetSec = (cumFrames / fps).toFixed(4);
        const outLabel = `vx${i}`;
        const boundary = directorBoundaries[i - 1];
        filterLines.push(
          `[${currentLabel}][${i}:v]xfade=transition=${boundary.transition}:duration=${(boundary.overlapFrames / fps).toFixed(6)}:offset=${offsetSec}[${outLabel}]`
        );
        currentLabel = outLabel;
        cumFrames += sceneFrameCounts[i];
      }
      videoOutLabel = currentLabel;
    } else if (segmentPaths.length > 1) {
      const concatInputs = segmentPaths.map((_, idx) => `[${idx}:v]`).join('');
      filterLines.push(`${concatInputs}concat=n=${segmentPaths.length}:v=1:a=0[vconcat]`);
      videoOutLabel = 'vconcat';
    } else {
      filterLines.push('[0:v]null[vsingle]');
      videoOutLabel = 'vsingle';
    }

    if (assPath) {
      filterLines.push(`[${videoOutLabel}]ass='${escapeFilterPath(assPath)}'[vfinal]`);
      videoOutLabel = 'vfinal';
    }

    // Audio filtergraph (48kHz stereo voiceover + sidechain-ducked music + grouped dense SFX cues)
    filterLines.push(
      `[${voiceInputIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo[vo_fmt]`
    );

    const amixInputs: string[] = [];

    if (hasMusic && input.backgroundMusic && musicInputIdx >= 0) {
      const volDb = Math.max(-36, Math.min(0, input.backgroundMusic.volumeDb ?? -14));
      if (input.backgroundMusic.duckingEnabled) {
        filterLines.push('[vo_fmt]asplit=2[vo_sc][vo_mix]');
        filterLines.push(
          `[${musicInputIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${volDb}dB[bg_vol]`
        );
        filterLines.push(
          '[bg_vol][vo_sc]sidechaincompress=threshold=0.02:ratio=6:attack=80:release=450[bg_ducked]'
        );
      } else {
        filterLines.push('[vo_fmt]anull[vo_mix]');
        filterLines.push(
          `[${musicInputIdx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${volDb}dB[bg_ducked]`
        );
      }
      amixInputs.push('[vo_mix]', '[bg_ducked]');
    } else {
      filterLines.push('[vo_fmt]anull[vo_mix]');
      amixInputs.push('[vo_mix]');
    }

    if (hasSfx) {
      const sfxVolDb = Math.max(-24, Math.min(3, input.sfxConfig.volumeDb ?? -5));
      for (const [cue, idx] of sfxInputIndices.entries()) {
        const eventsForCue = sfxEvents.filter((e) => e.cue === cue);
        filterLines.push(
          `[${idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${sfxVolDb}dB[sfx_base_${cue}]`
        );

        if (eventsForCue.length > 1) {
          const splitLabels = eventsForCue
            .map((_, j) => `[sfx_s_${cue}_${j}]`)
            .join('');
          filterLines.push(
            `[sfx_base_${cue}]asplit=${eventsForCue.length}${splitLabels}`
          );
        } else {
          filterLines.push(`[sfx_base_${cue}]anull[sfx_s_${cue}_0]`);
        }

        const cueBusInputs: string[] = [];
        for (let j = 0; j < eventsForCue.length; j++) {
          const delayMs = Math.max(0, Math.round(eventsForCue[j].atMs));
          const delayedLabel = `sfx_d_${cue}_${j}`;
          if (delayMs > 0) {
            filterLines.push(
              `[sfx_s_${cue}_${j}]adelay=${delayMs}|${delayMs}[${delayedLabel}]`
            );
          } else {
            filterLines.push(`[sfx_s_${cue}_${j}]anull[${delayedLabel}]`);
          }
          cueBusInputs.push(`[${delayedLabel}]`);
        }

        if (cueBusInputs.length > 1) {
          filterLines.push(
            `${cueBusInputs.join('')}amix=inputs=${cueBusInputs.length}:duration=longest:normalize=0[sfx_bus_${cue}]`
          );
          amixInputs.push(`[sfx_bus_${cue}]`);
        } else {
          amixInputs.push(cueBusInputs[0]);
        }
      }
    }

    if (amixInputs.length === 1) {
      filterLines.push('[vo_mix]alimiter=limit=0.92[afinal]');
    } else {
      filterLines.push(
        `${amixInputs.join('')}amix=inputs=${amixInputs.length}:duration=first:dropout_transition=2:normalize=0[amixed]`
      );
      filterLines.push(
        '[amixed]alimiter=limit=0.92[afinal]'
      );
    }

    const filterScriptPath = path.join(renderDir, 'master_filter.txt');
    await fs.writeFile(filterScriptPath, filterLines.join(';\n'), 'utf8');

    masterArgs.push(
      '-filter_complex_script',
      filterScriptPath,
      '-map',
      `[${videoOutLabel}]`,
      '-map',
      '[afinal]',
      ...buildEncoderArgs(activeEncoder),
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      '48000',
      '-t',
      exactAudioSec,
      '-movflags',
      '+faststart',
      outputPath
    );

    try {
      await spawnStreamCommand('ffmpeg', masterArgs);
    } catch (err) {
      if (activeEncoder !== 'libx264') {
        activeEncoder = 'libx264';
        const fallbackArgs = masterArgs.slice();
        const cvIdx = fallbackArgs.indexOf('-c:v');
        if (cvIdx !== -1) {
          const caIdx = fallbackArgs.indexOf('-c:a');
          fallbackArgs.splice(cvIdx, caIdx - cvIdx, ...buildEncoderArgs('libx264'));
        }
        await spawnStreamCommand('ffmpeg', fallbackArgs);
      } else {
        throw err;
      }
    }
  }

  const stat = await fs.stat(outputPath);

  emit({
    status: 'completed',
    progress: 100,
    currentScene: totalScenes,
    stage: 'Export complete',
    message: '1080p MP4 mastered with rapid micro-beats, graphic cards, kinetic typography & 12-cue SFX.',
    outputUrl: `/api/jobs/${input.jobId}/download`,
    fileSizeBytes: stat.size,
  });

  return outputPath;
  } finally {
    await fs.rm(renderDir, { recursive: true, force: true }).catch(() => {});
  }
}
