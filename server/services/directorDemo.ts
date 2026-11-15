import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { AspectRatio, ProjectSession, SceneItem } from '../../src/types/studio.ts';
import { sanitizeDirector, type TimedWord } from '../../src/director/types.ts';
import { attachSpeech, planMotion } from '../../src/director/planner.ts';
import type { ProjectRecord } from './projectStore.ts';
import { processUploadedMedia } from './imageProcessor.ts';
import { analyzeAudioTrack } from './audioAnalyzer.ts';
import { DEFAULT_SFX_CONFIG } from './sfxEngine.ts';
import { createMusicBed } from './musicBed.ts';

/** A curated, narrated demonstration works before any AI provider/model is installed. */
export async function createDirectorDemo(
  root: string,
  rawSettings: unknown,
  aspectRatio: AspectRatio
): Promise<ProjectRecord> {
  const settings = sanitizeDirector(rawSettings),
    id = `demo_${crypto.randomBytes(5).toString('hex')}`,
    projectDir = path.join(root, id);
  for (const dir of ['audio', 'images', 'thumbs', 'music'])
    await fs.mkdir(path.join(projectDir, dir), { recursive: true });
  const demo = fileURLToPath(new URL('../../public/assets/director-demo/', import.meta.url));
  const audioPath = path.join(projectDir, 'audio', 'voiceover.wav');
  await fs.copyFile(path.join(demo, 'narration.wav'), audioPath);
  const timing = JSON.parse(await fs.readFile(path.join(demo, 'timing.json'), 'utf8')) as {
    script: string;
    durationMs: number;
    words: TimedWord[];
  };
  const audio = await analyzeAudioTrack(audioPath);
  const names = [
    'sample_notebook_desk_1794687285469.jpg',
    'sample_villagers_laughing_1794687284065.jpg',
    'sample_analytics_zero_1794687284970.jpg',
    'sample_mountain_sunrise_1794687284666.jpg',
  ];
  const descriptions = [
    'A notebook and microphone ready for a new idea.',
    'People gathering to share a story.',
    'A laptop displaying analytics.',
    'A person looking across a mountain sunrise.',
  ];
  const phrases = [
    'One idea can change everything.',
    'But a clear story makes it matter.',
    'Small steps build real progress.',
    'Give every word a purpose.',
  ];
  const mediaById: ProjectRecord['mediaById'] = new Map(),
    thumbPathsById = new Map<string, string>(),
    images: ProjectSession['images'] = [];
  const drafts: SceneItem[] = [];
  for (let i = 0; i < 4; i++) {
    const imageId = `demo_image_${i}`,
      saved = `${imageId}.jpg`,
      destination = path.join(projectDir, 'images', saved);
    await fs.copyFile(
      fileURLToPath(new URL(`../../src/assets/images/${names[i]}`, import.meta.url)),
      destination
    );
    const meta = await processUploadedMedia(
      destination,
      path.join(projectDir, 'thumbs'),
      imageId,
      saved
    );
    mediaById.set(imageId, { path: destination, mediaType: 'image' });
    thumbPathsById.set(imageId, meta.thumbPath);
    images.push({
      id: imageId,
      originalName: saved,
      mediaType: 'image',
      width: meta.width,
      height: meta.height,
      url: `/api/media/${id}/images/${saved}`,
      thumbUrl: `/api/media/${id}/thumbs/${imageId}.jpg`,
      visualSummary: descriptions[i],
    });
    drafts.push({
      id: `demo_scene_${i}`,
      index: i,
      text: phrases[i],
      startMs: (i * audio.durationMs) / 4,
      endMs: ((i + 1) * audio.durationMs) / 4,
      durationMs: audio.durationMs / 4,
      imageId,
      matchReason: 'Curated demonstration asset; not an automatic vision assignment.',
      emotionalWeight: 1,
      kenBurnsDirection: 'zoom-in',
      snappedToPause: false,
      alignmentSource: 'voice-locked',
      beatKind: 'media',
      sfxCue: 'pop',
    });
  }
  const speech = { engine: 'faster-whisper' as const, coverage: 1, words: timing.words };
  const scenes = attachSpeech(drafts, speech, audio.durationMs),
    directed = planMotion(scenes, settings.preset, speech);
  directed.report.notices.push(
    'Built-in demonstration: curated images and precomputed speech timestamps. Your own uploads use the configured vision/speech engines.'
  );
  let musicPath: string | undefined;
  if (settings.music !== 'none') {
    musicPath = path.join(projectDir, 'music', 'director_music.wav');
    await createMusicBed(musicPath, audio.durationMs, settings.preset);
  }
  const session: ProjectSession = {
    id,
    createdAt: new Date().toISOString(),
    aspectRatio,
    pacingMode: 'upload-match',
    motionIntensity: 'subtle',
    transitionStyle: 'whip-dynamic',
    transitionDurationMs: 160,
    subtitlesEnabled: true,
    captionMode: 'explainer-kinetic',
    textEffect: 'kinetic-karaoke',
    fontStyle: 'modern-sans',
    accentColor: 'coral',
    brandKicker: 'SCENESYNC STUDIO',
    sfxConfig: { ...DEFAULT_SFX_CONFIG, volumeDb: -10 },
    matchingEngineUsed: 'local-heuristic',
    fallbackNotice:
      'Curated demo, with real narration. Automatic image matching is not exercised by this demonstration.',
    rawScript: timing.script,
    images,
    scenes: directed.scenes,
    directorSettings: settings,
    directorReport: directed.report,
    audio: {
      ...audio,
      filename: 'SceneSync narrated demo.wav',
      url: `/api/media/${id}/audio/voiceover.wav`,
    },
    ...(musicPath
      ? {
          backgroundMusic: {
            source:'procedural' as const,
              filename: 'SceneSync original underscore',
            url: `/api/media/${id}/music/director_music.wav`,
            durationMs: audio.durationMs,
            volumeDb: -18,
            duckingEnabled: true,
          },
        }
      : {}),
  };
  return { session, projectDir, audioPath, musicPath, mediaById, thumbPathsById };
}
