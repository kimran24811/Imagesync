import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { EventEmitter } from 'node:events';
import { EventEmitter as NodeEventEmitter } from 'node:events';
import express from 'express';
import multer from 'multer';
import type {
  AccentColorId,
  ArtStylePresetId,
  AspectRatio,
  BackgroundMusicTrack,
  BeatKind,
  CaptionMode,
  CaptionZone,
  FocalCropRegion,
  FontStyleId,
  GraphicCardData,
  GraphicCardTheme,
  MatchingPreference,
  MediaType,
  MotionIntensity,
  PacingMode,
  ProjectSession,
  RenderJobState,
  SceneItem,
  SfxConfig,
  SfxCueType,
  TextEffectId,
  TransitionStyle,
  TtsVoiceName,
} from '../../src/types/studio.ts';
import {
  analyzeAudioTrack,
  createGeminiAudioProxy,
  probeAudioDurationMs,
} from '../services/audioAnalyzer.ts';
import {
  ART_STYLE_PRESETS,
  generateBlueprintVoiceoverWav,
  generateStoryBlueprint,
} from '../services/blueprintGenerator.ts';
import { probeEncoders } from '../services/encoderProbe.ts';
import { isGeminiConfigured } from '../services/geminiClient.ts';
import { getOllamaVisionStatus } from '../services/ollamaVision.ts';
import { processUploadedMedia } from '../services/imageProcessor.ts';
import {
  copySampleImagesToDir,
  generateSampleAudioWav,
  SAMPLE_SCRIPT,
} from '../services/sampleGenerator.ts';
import {
  alignScriptAndImages,
  computeDynamicSceneTimings,
  serializeImagesWithSummaries,
} from '../services/sceneAligner.ts';
import {
  ALL_ACTIVE_SFX_CUES,
  DEFAULT_SFX_CONFIG,
  ensureSfxBank,
  type ActiveSfxCue,
} from '../services/sfxEngine.ts';
import { renderProjectMp4 } from '../services/videoRenderer.ts';

interface StoredProject {
  session: ProjectSession;
  projectDir: string;
  audioPath: string;
  musicPath?: string;
  mediaById: Map<string, { path: string; mediaType: MediaType }>;
  thumbPathsById: Map<string, string>;
}

interface StoredJob {
  state: RenderJobState;
  outputPath?: string;
  emitter: EventEmitter;
}

interface StagedFileRecord {
  fileKey: string;
  originalName: string;
  role: 'audio' | 'music' | 'media';
  filePath: string;
  orderIndex: number;
}

interface StagedUploadSession {
  uploadId: string;
  stagingDir: string;
  filesByKey: Map<string, StagedFileRecord>;
  createdAt: number;
}

interface AnalyzeJobState {
  jobId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  progress: number;
  message: string;
  session?: ProjectSession;
  error?: string;
}

const WORKSPACE_ROOT = path.resolve(process.cwd(), 'workspace_data');
const UPLOAD_TMP_DIR = path.join(WORKSPACE_ROOT, '_tmp_uploads');
const STAGED_UPLOADS_DIR = path.join(WORKSPACE_ROOT, '_staged_uploads');
const SFX_BANK_DIR = path.join(WORKSPACE_ROOT, '_sfx_bank');
const BLUEPRINT_TTS_DIR = path.join(WORKSPACE_ROOT, '_blueprint_tts');
const JOBS_META_DIR = path.join(WORKSPACE_ROOT, '_jobs');

const projects = new Map<string, StoredProject>();
const jobs = new Map<string, StoredJob>();
const stagedUploads = new Map<string, StagedUploadSession>();
const analyzeJobs = new Map<string, AnalyzeJobState>();

async function ensureDirs(): Promise<void> {
  await fs.mkdir(WORKSPACE_ROOT, { recursive: true });
  await fs.mkdir(UPLOAD_TMP_DIR, { recursive: true });
  await fs.mkdir(STAGED_UPLOADS_DIR, { recursive: true });
  await fs.mkdir(SFX_BANK_DIR, { recursive: true });
  await fs.mkdir(BLUEPRINT_TTS_DIR, { recursive: true });
  await fs.mkdir(JOBS_META_DIR, { recursive: true });
  await ensureSfxBank(SFX_BANK_DIR);
}

async function persistJobMetadata(job: StoredJob): Promise<void> {
  try {
    await fs.mkdir(JOBS_META_DIR, { recursive: true });
    const safeId = job.state.jobId.replace(/[^a-zA-Z0-9_-]/g, '');
    await fs.writeFile(
      path.join(JOBS_META_DIR, `${safeId}.json`),
      JSON.stringify({ state: job.state, outputPath: job.outputPath }),
      'utf8'
    );
  } catch {
    // Best-effort metadata persistence
  }
}

async function resolveJobRecord(jobId: string): Promise<StoredJob | undefined> {
  const safeId = jobId.replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safeId) return undefined;

  const mem = jobs.get(safeId);
  if (mem) return mem;

  // Fallback 1: Read persisted job metadata JSON
  try {
    const raw = await fs.readFile(path.join(JOBS_META_DIR, `${safeId}.json`), 'utf8');
    const parsed = JSON.parse(raw) as { state?: RenderJobState; outputPath?: string };
    if (parsed.state) {
      let validOutput = parsed.outputPath;
      if (validOutput) {
        try {
          const stat = await fs.stat(validOutput);
          parsed.state.fileSizeBytes = stat.size;
        } catch {
          validOutput = undefined;
        }
      }
      const restored: StoredJob = {
        state: parsed.state,
        outputPath: validOutput,
        emitter: new NodeEventEmitter(),
      };
      jobs.set(safeId, restored);
      return restored;
    }
  } catch {
    // Check workspace folders directly below
  }

  // Fallback 2: Scan workspace_data/*/scenesync_*_<jobId>.mp4 on disk
  try {
    const entries = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('_')) continue;
      const candidate = path.join(WORKSPACE_ROOT, entry.name, `scenesync_${entry.name}_${safeId}.mp4`);
      try {
        const stat = await fs.stat(candidate);
        const restoredState: RenderJobState = {
          jobId: safeId,
          projectId: entry.name,
          status: 'completed',
          progress: 100,
          currentScene: 1,
          totalScenes: 1,
          stage: 'Export complete',
          message: 'Recovered mastered 1080p MP4 from workspace storage.',
          encoderUsed: 'libx264',
          elapsedMs: 0,
          outputUrl: `/api/jobs/${safeId}/download`,
          fileSizeBytes: stat.size,
        };
        const restored: StoredJob = {
          state: restoredState,
          outputPath: candidate,
          emitter: new NodeEventEmitter(),
        };
        jobs.set(safeId, restored);
        return restored;
      } catch {
        // Not in this project folder
      }
    }
  } catch {
    // Ignore directory read error
  }

  return undefined;
}

void ensureDirs();

const upload = multer({
  dest: UPLOAD_TMP_DIR,
  limits: {
    fileSize: 350 * 1024 * 1024,
    files: 130,
  },
});

function sanitizeAspectRatio(val: unknown): AspectRatio {
  return val === '16:9' ? '16:9' : '9:16';
}

function sanitizeMotionIntensity(val: unknown): MotionIntensity {
  if (val === 'moderate' || val === 'none') return val;
  return 'subtle';
}

function sanitizeMatchingPreference(val: unknown): MatchingPreference {
  if (val === 'gemini' || val === 'ollama' || val === 'local') return val;
  return 'auto';
}

function sanitizePacingMode(val: unknown): PacingMode {
  if (val === 'dynamic-explainer' || val === 'upload-match') return val;
  return 'rapid-reel';
}

function sanitizeGraphicCardTheme(val: unknown): GraphicCardTheme {
  if (val === 'cream-poster' || val === 'noir-gold') return val;
  return 'obsidian';
}

function sanitizeTransitionStyle(val: unknown): TransitionStyle {
  if (val === 'cut' || val === 'crossfade') return val;
  return 'whip-dynamic';
}

function sanitizeBoolean(val: unknown, fallback: boolean): boolean {
  if (typeof val === 'boolean') return val;
  if (val === 'true') return true;
  if (val === 'false') return false;
  return fallback;
}

function sanitizeVolumeDb(val: unknown, fallback = -14): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(-36, Math.min(-2, Math.round(n)));
}

function sanitizeCaptionMode(val: unknown, fallback: CaptionMode = 'explainer-kinetic'): CaptionMode {
  if (val === 'explainer-kinetic' || val === 'word-pop' || val === 'bottom-third' || val === 'off') {
    return val;
  }
  return fallback;
}

function sanitizeTextEffect(val: unknown, fallback: TextEffectId = 'type-reveal'): TextEffectId {
  if (
    val === 'type-reveal' ||
    val === 'kinetic-karaoke' ||
    val === 'punch-pop' ||
    val === 'slide-up' ||
    val === 'highlight-box'
  ) {
    return val;
  }
  return fallback;
}

function sanitizeFontStyle(val: unknown, fallback: FontStyleId = 'modern-sans'): FontStyleId {
  if (
    val === 'modern-sans' ||
    val === 'mixed-editorial' ||
    val === 'editorial-serif' ||
    val === 'mono-tech'
  ) {
    return val;
  }
  return fallback;
}

function sanitizeAccentColor(val: unknown, fallback: AccentColorId = 'coral'): AccentColorId {
  if (val === 'coral' || val === 'gold' || val === 'cyan' || val === 'emerald') {
    return val;
  }
  return fallback;
}

function sanitizeSfxConfig(raw: unknown, fallback: SfxConfig = DEFAULT_SFX_CONFIG): SfxConfig {
  let obj: Record<string, unknown> | null = null;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      obj = null;
    }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>;
  }
  if (!obj) return { ...fallback };
  const vol = Number(obj.volumeDb);
  return {
    enabled: sanitizeBoolean(obj.enabled, fallback.enabled),
    volumeDb: Number.isFinite(vol) ? Math.max(-24, Math.min(3, Math.round(vol))) : fallback.volumeDb,
    includeTransitionWhoosh: sanitizeBoolean(obj.includeTransitionWhoosh, fallback.includeTransitionWhoosh),
    includeTextPop: sanitizeBoolean(obj.includeTextPop, fallback.includeTextPop),
    includeHookImpact: sanitizeBoolean(obj.includeHookImpact, fallback.includeHookImpact),
    includeMicroBeatTicks: sanitizeBoolean(obj.includeMicroBeatTicks, fallback.includeMicroBeatTicks),
  };
}

const VALID_ART_STYLES = new Set<ArtStylePresetId>([
  'saveo-ink',
  'stick-figure',
  'noir-gold',
  'whiteboard-sketch',
  'documentary-35mm',
  'editorial-cream',
  'midnight-crimson',
  'stylized-3d',
  'custom',
]);

function sanitizeArtStyleId(val: unknown): ArtStylePresetId {
  if (typeof val === 'string' && VALID_ART_STYLES.has(val as ArtStylePresetId)) {
    return val as ArtStylePresetId;
  }
  return 'saveo-ink';
}

const VALID_SFX_HINT_SET = new Set<string>(['none', ...ALL_ACTIVE_SFX_CUES]);

function sanitizeHintSfxCue(cue: string | undefined, fallback: SfxCueType | undefined): SfxCueType | undefined {
  if (cue && VALID_SFX_HINT_SET.has(cue)) {
    return cue as SfxCueType;
  }
  return fallback;
}

function sanitizeTtsVoice(val: unknown): TtsVoiceName {
  if (val === 'Charon' || val === 'Fenrir' || val === 'Kore' || val === 'Puck' || val === 'Zephyr') {
    return val;
  }
  return 'Charon';
}

function getSafeExtension(filename: string, fallback: string): string {
  const ext = path.extname(filename).toLowerCase();
  return /^\.[a-z0-9]{2,5}$/.test(ext) ? ext : fallback;
}

export function createStudioRouter(): express.Router {
  const router = express.Router();

  // 0. Serve procedural SFX WAV files for live preview parity
  router.get('/sfx/:cue', async (req, res) => {
    const cue = req.params.cue as ActiveSfxCue;
    if (!ALL_ACTIVE_SFX_CUES.includes(cue)) {
      res.status(404).json({ error: 'Unknown SFX cue.' });
      return;
    }
    try {
      const bank = await ensureSfxBank(SFX_BANK_DIR);
      res.sendFile(bank[cue]);
    } catch {
      res.status(500).json({ error: 'Failed to synthesize SFX cue.' });
    }
  });

  // 0b. Generate Style-Locked Story Blueprint & Prompt Pack (100% Free)
  router.get('/blueprint/presets', (_req, res) => {
    res.json({ presets: ART_STYLE_PRESETS });
  });

  router.post('/blueprint', async (req, res) => {
    try {
      const topic = String(req.body?.topic ?? '').trim();
      const language = String(req.body?.language ?? 'English').trim() || 'English';
      const rawSceneCount = req.body?.sceneCount;
      const sceneCount: number | 'auto' =
        rawSceneCount === 'auto'
          ? 'auto'
          : Math.max(3, Math.min(60, Math.round(Number(rawSceneCount ?? 8) || 8)));
      const aspectRatio = sanitizeAspectRatio(req.body?.aspectRatio);
      const artStyleId = sanitizeArtStyleId(req.body?.artStyleId);
      const customStyleNote = typeof req.body?.customStyleNote === 'string' ? req.body.customStyleNote : '';

      const blueprint = await generateStoryBlueprint({
        topic,
        language,
        sceneCount,
        aspectRatio,
        artStyleId,
        customStyleNote,
      });
      res.json(blueprint);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Blueprint generation failed.';
      res.status(400).json({ error: message });
    }
  });

  // 0c. Generate optional free-tier Gemini TTS Voiceover WAV
  router.post('/blueprint/tts', async (req, res) => {
    try {
      const script = String(req.body?.script ?? '').trim();
      const voiceName = sanitizeTtsVoice(req.body?.voiceName);
      const deliveryStyle = String(req.body?.deliveryStyle ?? '').trim();
      const fileId = `tts_${Date.now()}_${crypto.randomBytes(3).toString('hex')}.wav`;
      const destPath = path.join(BLUEPRINT_TTS_DIR, fileId);

      await fs.mkdir(BLUEPRINT_TTS_DIR, { recursive: true });
      await generateBlueprintVoiceoverWav({
        script,
        voiceName,
        deliveryStyle,
        destPath,
      });

      const durationMs = await probeAudioDurationMs(destPath);
      res.json({
        fileId,
        filename: `narrator_${voiceName.toLowerCase()}.wav`,
        url: `/api/blueprint/audio/${fileId}`,
        durationMs,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Voiceover generation failed.';
      res.status(400).json({ error: message });
    }
  });

  router.get('/blueprint/audio/:fileId', async (req, res) => {
    const safeName = path.basename(req.params.fileId);
    const fullPath = path.join(BLUEPRINT_TTS_DIR, safeName);
    try {
      await fs.access(fullPath);
      res.sendFile(fullPath);
    } catch {
      res.status(404).json({ error: 'Generated voiceover file not found.' });
    }
  });

  // 1. Probe system capabilities
  router.get('/capabilities', async (_req, res) => {
    try {
      const [encoderInfo, ollama] = await Promise.all([probeEncoders(), getOllamaVisionStatus()]);
      res.json({
        ffmpegVersion: encoderInfo.ffmpegVersion,
        geminiConfigured: isGeminiConfigured(),
        ollamaVisionAvailable: ollama.available,
        ollamaVisionModel: ollama.model,
        ollamaVisionHelp: ollama.reason,
        availableEncoders: encoderInfo.availableEncoders,
        recommendedEncoder: encoderInfo.recommendedEncoder,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to inspect capabilities';
      res.status(500).json({ error: message });
    }
  });

  // 1b. Chunked Upload Session Init (avoids Cloud Run 32MB single-request payload limits)
  router.post('/uploads/init', async (_req, res) => {
    try {
      const uploadId = `up_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const stagingDir = path.join(STAGED_UPLOADS_DIR, uploadId);
      await fs.mkdir(stagingDir, { recursive: true });
      stagedUploads.set(uploadId, {
        uploadId,
        stagingDir,
        filesByKey: new Map(),
        createdAt: Date.now(),
      });
      res.json({ uploadId });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to initialize upload session.';
      res.status(500).json({ error: msg });
    }
  });

  // 1c. Receive individual file chunk (<= 8MB per request)
  router.post('/uploads/:uploadId/chunk', upload.single('chunk'), async (req, res) => {
    const staged = stagedUploads.get(req.params.uploadId);
    const chunkFile = req.file;
    try {
      if (!staged) {
        if (chunkFile) await fs.rm(chunkFile.path, { force: true }).catch(() => {});
        res.status(404).json({ error: 'Upload session expired or not found. Please retry.' });
        return;
      }
      if (!chunkFile) {
        res.status(400).json({ error: 'Missing file chunk payload.' });
        return;
      }

      const roleRaw = String(req.body?.role ?? 'media');
      const role: 'audio' | 'music' | 'media' =
        roleRaw === 'audio' || roleRaw === 'music' ? roleRaw : 'media';
      const fileKey = String(req.body?.fileKey ?? '').replace(/[^a-zA-Z0-9_-]/g, '') || crypto.randomBytes(4).toString('hex');
      const originalName = String(req.body?.filename ?? 'upload.bin');
      const chunkIndex = Math.max(0, Number(req.body?.chunkIndex ?? 0));
      const orderIndex = Math.max(0, Number(req.body?.orderIndex ?? 0));

      const ext = getSafeExtension(originalName, role === 'audio' || role === 'music' ? '.mp3' : '.jpg');
      const destPath = path.join(staged.stagingDir, `${role}_${fileKey}${ext}`);

      const chunkBuf = await fs.readFile(chunkFile.path);
      await fs.rm(chunkFile.path, { force: true }).catch(() => {});

      if (chunkIndex === 0) {
        await fs.writeFile(destPath, chunkBuf);
      } else {
        await fs.appendFile(destPath, chunkBuf);
      }

      staged.filesByKey.set(fileKey, {
        fileKey,
        originalName,
        role,
        filePath: destPath,
        orderIndex,
      });

      res.json({ ok: true, fileKey, chunkIndex });
    } catch (err: unknown) {
      if (chunkFile) await fs.rm(chunkFile.path, { force: true }).catch(() => {});
      const msg = err instanceof Error ? err.message : 'Chunk upload failed.';
      res.status(500).json({ error: msg });
    }
  });

  // 1d. Start async analysis from staged uploaded files
  router.post('/uploads/:uploadId/analyze', async (req, res) => {
    const staged = stagedUploads.get(req.params.uploadId);
    if (!staged) {
      res.status(404).json({ error: 'Upload session expired or missing. Please click Generate Timeline again.' });
      return;
    }

    const allFiles = Array.from(staged.filesByKey.values()).sort(
      (a, b) => a.orderIndex - b.orderIndex
    );
    const audioRec = allFiles.find((f) => f.role === 'audio');
    const musicRec = allFiles.find((f) => f.role === 'music');
    const mediaRecs = allFiles.filter((f) => f.role === 'media');

    if (!audioRec) {
      res.status(400).json({ error: 'Voiceover audio was not uploaded.' });
      return;
    }
    if (mediaRecs.length === 0) {
      res.status(400).json({ error: 'Please upload at least one photo or video clip.' });
      return;
    }

    const rawScript = String(req.body?.script ?? '').trim();
    if (!rawScript) {
      res.status(400).json({ error: 'Please paste your voiceover script.' });
      return;
    }

    const aspectRatio = sanitizeAspectRatio(req.body?.aspectRatio);
    const pacingMode = sanitizePacingMode(req.body?.pacingMode);
    const graphicCardTheme = sanitizeGraphicCardTheme(req.body?.graphicCardTheme);
    const motionIntensity = sanitizeMotionIntensity(req.body?.motionIntensity);
    const matchingPreference = sanitizeMatchingPreference(req.body?.matchingPreference);
    const transitionStyle = sanitizeTransitionStyle(req.body?.transitionStyle);
    const captionMode = sanitizeCaptionMode(
      req.body?.captionMode,
      sanitizeBoolean(req.body?.subtitlesEnabled, true) ? 'explainer-kinetic' : 'off'
    );
    const subtitlesEnabled = captionMode !== 'off';
    const textEffect = sanitizeTextEffect(req.body?.textEffect, 'type-reveal');
    const fontStyle = sanitizeFontStyle(req.body?.fontStyle, 'modern-sans');
    const accentColor = sanitizeAccentColor(req.body?.accentColor, 'coral');
    const brandKicker = String(req.body?.brandKicker ?? '').trim().slice(0, 48);
    const sfxConfig = sanitizeSfxConfig(req.body?.sfxConfig, DEFAULT_SFX_CONFIG);
    const musicVolumeDb = sanitizeVolumeDb(req.body?.musicVolumeDb, -14);
    const musicDucking = sanitizeBoolean(req.body?.musicDucking, true);
    const sceneHints = Array.isArray(req.body?.sceneHints)
      ? (req.body.sceneHints as Array<{
          kicker?: string;
          accentPhrase?: string;
          sfxCue?: string;
          imagePrompt?: string;
          beatKind?: BeatKind;
          graphicCard?: GraphicCardData;
        }>)
      : [];

    const jobId = `az_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
    const jobState: AnalyzeJobState = {
      jobId,
      status: 'processing',
      progress: 8,
      message: 'Analyzing voiceover cadence & pauses...',
    };
    analyzeJobs.set(jobId, jobState);
    stagedUploads.delete(staged.uploadId);

    void (async () => {
      try {
        const projectId = crypto.randomBytes(6).toString('hex');
        const projectDir = path.join(WORKSPACE_ROOT, projectId);
        const audioDir = path.join(projectDir, 'audio');
        const musicDir = path.join(projectDir, 'music');
        const mediaDir = path.join(projectDir, 'images');
        const thumbsDir = path.join(projectDir, 'thumbs');

        await Promise.all([
          fs.mkdir(audioDir, { recursive: true }),
          fs.mkdir(musicDir, { recursive: true }),
          fs.mkdir(mediaDir, { recursive: true }),
          fs.mkdir(thumbsDir, { recursive: true }),
        ]);

        const audioExt = getSafeExtension(audioRec.originalName, '.mp3');
        const savedAudioName = `voiceover${audioExt}`;
        const savedAudioPath = path.join(audioDir, savedAudioName);
        await fs.rename(audioRec.filePath, savedAudioPath);

        const audioAnalysis = await analyzeAudioTrack(savedAudioPath);

        let savedMusicPath: string | undefined;
        let backgroundMusic: BackgroundMusicTrack | undefined;
        if (musicRec) {
          const musicExt = getSafeExtension(musicRec.originalName, '.mp3');
          const savedMusicName = `music_bed${musicExt}`;
          savedMusicPath = path.join(musicDir, savedMusicName);
          await fs.rename(musicRec.filePath, savedMusicPath);
          const musicDurationMs = await probeAudioDurationMs(savedMusicPath);
          backgroundMusic = {
            filename: musicRec.originalName,
            url: `/api/media/${projectId}/music/${savedMusicName}`,
            durationMs: musicDurationMs,
            volumeDb: musicVolumeDb,
            duckingEnabled: musicDucking,
          };
        }

        jobState.progress = 25;
        jobState.message = 'Preparing audio proxy for timeline alignment...';

        let audioProxyPath: string | undefined;
        if (matchingPreference !== 'local' && isGeminiConfigured()) {
          try {
            const proxyPath = path.join(audioDir, 'gemini_proxy.mp3');
            await createGeminiAudioProxy(savedAudioPath, proxyPath);
            audioProxyPath = proxyPath;
          } catch {
            audioProxyPath = undefined;
          }
        }

        const mediaById = new Map<string, { path: string; mediaType: MediaType }>();
        const thumbPathsById = new Map<string, string>();
        const processedMedia: Array<{
          id: string;
          originalName: string;
          mediaType: MediaType;
          clipDurationMs?: number;
          url: string;
          thumbUrl: string;
          thumbPath: string;
          width: number;
          height: number;
        }> = [];

        for (let i = 0; i < mediaRecs.length; i++) {
          const rec = mediaRecs[i];
          jobState.progress = Math.round(28 + ((i + 1) / mediaRecs.length) * 34);
          jobState.message = `Processing visual ${i + 1} of ${mediaRecs.length}...`;

          const mediaId = `media_${String(i + 1).padStart(2, '0')}_${crypto.randomBytes(2).toString('hex')}`;
          const mExt = getSafeExtension(rec.originalName, '.jpg');
          const savedName = `${mediaId}${mExt}`;
          const savedPath = path.join(mediaDir, savedName);
          await fs.rename(rec.filePath, savedPath);

          const meta = await processUploadedMedia(
            savedPath,
            thumbsDir,
            mediaId,
            rec.originalName
          );
          mediaById.set(mediaId, { path: savedPath, mediaType: meta.mediaType });
          thumbPathsById.set(mediaId, meta.thumbPath);

          processedMedia.push({
            id: mediaId,
            originalName: rec.originalName,
            mediaType: meta.mediaType,
            clipDurationMs: meta.clipDurationMs,
            url: `/api/media/${projectId}/images/${savedName}`,
            thumbUrl: `/api/media/${projectId}/thumbs/${mediaId}.jpg`,
            thumbPath: meta.thumbPath,
            width: meta.width,
            height: meta.height,
          });
        }

        await fs.rm(staged.stagingDir, { recursive: true, force: true }).catch(() => {});

        jobState.progress = 72;
        jobState.message = 'Matching scenes & synchronizing cuts to voiceover...';

        const alignment = await alignScriptAndImages({
          rawScript,
          audioDurationMs: audioAnalysis.durationMs,
          audioProxyPath,
          pauses: audioAnalysis.pauses,
          images: processedMedia,
          matchingPreference,
          visionCacheDir: path.join(WORKSPACE_ROOT, '_vision_cache'),
          onVisualProgress: (completed, total) => {
            jobState.progress = Math.round(72 + (completed / Math.max(1, total)) * 18);
            jobState.message = `AI inspecting picture ${completed} of ${total} and matching to narration...`;
          },
          pacingMode,
          graphicCardTheme,
        });

        const serializedImages = serializeImagesWithSummaries(
          processedMedia,
          alignment.imageSummaries
        );

        const mergedScenes = alignment.scenes.map((scene, idx) => {
          const hint = sceneHints[idx];
          if (!hint) return scene;
          return {
            ...scene,
            kicker: (hint.kicker ?? '').trim() || scene.kicker,
            accentPhrase: (hint.accentPhrase ?? '').trim() || scene.accentPhrase,
            sfxCue: sanitizeHintSfxCue(hint.sfxCue, scene.sfxCue),
            imagePrompt: (hint.imagePrompt ?? '').trim() || scene.imagePrompt,
            beatKind: hint.beatKind ?? scene.beatKind,
            graphicCard: hint.graphicCard ?? scene.graphicCard,
          };
        });

        const session: ProjectSession = {
          id: projectId,
          createdAt: new Date().toISOString(),
          aspectRatio,
          pacingMode,
          motionIntensity,
          transitionStyle,
          transitionDurationMs: transitionStyle === 'whip-dynamic' ? 140 : 280,
          subtitlesEnabled,
          captionMode,
          textEffect,
          fontStyle,
          accentColor,
          brandKicker,
          sfxConfig,
          matchingEngineUsed: alignment.engineUsed,
          fallbackNotice: alignment.fallbackNotice,
          audio: {
            filename: audioRec.originalName,
            url: `/api/media/${projectId}/audio/${savedAudioName}`,
            durationMs: audioAnalysis.durationMs,
            sampleRate: audioAnalysis.sampleRate,
            channels: audioAnalysis.channels,
            codec: audioAnalysis.codec,
            waveformPeaks: audioAnalysis.waveformPeaks,
            pauses: audioAnalysis.pauses,
          },
          backgroundMusic,
          rawScript,
          images: serializedImages,
          scenes: mergedScenes,
        };

        projects.set(projectId, {
          session,
          projectDir,
          audioPath: savedAudioPath,
          musicPath: savedMusicPath,
          mediaById,
          thumbPathsById,
        });

        jobState.status = 'completed';
        jobState.progress = 100;
        jobState.message = 'Timeline ready.';
        jobState.session = session;
      } catch (err: unknown) {
        jobState.status = 'failed';
        jobState.error = err instanceof Error ? err.message : 'Analysis failed.';
        jobState.message = jobState.error;
      }
    })();

    res.json({ jobId, status: jobState.status, progress: jobState.progress, message: jobState.message });
  });

  // 1e. Poll async analysis job
  router.get('/analyze-jobs/:jobId', (req, res) => {
    const job = analyzeJobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Analysis job not found.' });
      return;
    }
    res.json(job);
  });

  // 2. Serve stored media securely (audio, music, images/video clips, thumbnails)
  router.get('/media/:projectId/:kind/:filename', async (req, res) => {
    const { projectId, kind, filename } = req.params;
    const stored = projects.get(projectId);
    if (!stored) {
      res.status(404).json({ error: 'Project session not found.' });
      return;
    }
    if (!['audio', 'music', 'images', 'thumbs'].includes(kind)) {
      res.status(400).json({ error: 'Invalid media category.' });
      return;
    }
    const safeName = path.basename(filename);
    const fullPath = path.join(stored.projectDir, kind, safeName);
    try {
      await fs.access(fullPath);
      res.sendFile(fullPath);
    } catch {
      res.status(404).json({ error: 'Media file not found.' });
    }
  });

  // 3. Analyze uploaded voiceover, optional music bed, script, and unordered photos/B-roll clips
  router.post(
    '/analyze',
    upload.fields([
      { name: 'audio', maxCount: 1 },
      { name: 'music', maxCount: 1 },
      { name: 'images', maxCount: 120 },
    ]),
    async (req, res) => {
      const files = req.files as Record<string, Express.Multer.File[]> | undefined;
      const audioFile = files?.audio?.[0];
      const musicFile = files?.music?.[0];
      const mediaFiles = files?.images ?? [];

      try {
        if (!audioFile) {
          res.status(400).json({ error: 'Please upload an .mp3 or .wav voiceover audio file.' });
          return;
        }
        if (mediaFiles.length === 0) {
          res.status(400).json({ error: 'Please upload at least one photo or B-roll video clip.' });
          return;
        }

        const rawScript = String(req.body.script ?? '').trim();
        if (!rawScript) {
          res.status(400).json({ error: 'Please paste your voiceover script.' });
          return;
        }

        const aspectRatio = sanitizeAspectRatio(req.body.aspectRatio);
        const pacingMode = sanitizePacingMode(req.body.pacingMode);
        const graphicCardTheme = sanitizeGraphicCardTheme(req.body.graphicCardTheme);
        const motionIntensity = sanitizeMotionIntensity(req.body.motionIntensity);
        const matchingPreference = sanitizeMatchingPreference(req.body.matchingPreference);
        const transitionStyle = sanitizeTransitionStyle(req.body.transitionStyle);
        const captionMode = sanitizeCaptionMode(
          req.body.captionMode,
          sanitizeBoolean(req.body.subtitlesEnabled, true) ? 'explainer-kinetic' : 'off'
        );
        const subtitlesEnabled = captionMode !== 'off';
        const textEffect = sanitizeTextEffect(req.body.textEffect, 'type-reveal');
        const fontStyle = sanitizeFontStyle(req.body.fontStyle, 'modern-sans');
        const accentColor = sanitizeAccentColor(req.body.accentColor, 'coral');
        const brandKicker = String(req.body.brandKicker ?? '').trim().slice(0, 48);
        const sfxConfig = sanitizeSfxConfig(req.body.sfxConfig, DEFAULT_SFX_CONFIG);
        const musicVolumeDb = sanitizeVolumeDb(req.body.musicVolumeDb, -14);
        const musicDucking = sanitizeBoolean(req.body.musicDucking, true);

        let sceneHints: Array<{ kicker?: string; accentPhrase?: string; sfxCue?: string; imagePrompt?: string; beatKind?: BeatKind; graphicCard?: GraphicCardData }> = [];
        if (typeof req.body.sceneHints === 'string') {
          try {
            const parsedHints = JSON.parse(req.body.sceneHints);
            if (Array.isArray(parsedHints)) sceneHints = parsedHints;
          } catch {
            sceneHints = [];
          }
        }

        const projectId = crypto.randomBytes(6).toString('hex');
        const projectDir = path.join(WORKSPACE_ROOT, projectId);
        const audioDir = path.join(projectDir, 'audio');
        const musicDir = path.join(projectDir, 'music');
        const mediaDir = path.join(projectDir, 'images');
        const thumbsDir = path.join(projectDir, 'thumbs');

        await Promise.all([
          fs.mkdir(audioDir, { recursive: true }),
          fs.mkdir(musicDir, { recursive: true }),
          fs.mkdir(mediaDir, { recursive: true }),
          fs.mkdir(thumbsDir, { recursive: true }),
        ]);

        const audioExt = getSafeExtension(audioFile.originalname, '.mp3');
        const savedAudioName = `voiceover${audioExt}`;
        const savedAudioPath = path.join(audioDir, savedAudioName);
        await fs.rename(audioFile.path, savedAudioPath);

        const audioAnalysis = await analyzeAudioTrack(savedAudioPath);

        let savedMusicPath: string | undefined;
        let backgroundMusic: BackgroundMusicTrack | undefined;
        if (musicFile) {
          const musicExt = getSafeExtension(musicFile.originalname, '.mp3');
          const savedMusicName = `music_bed${musicExt}`;
          savedMusicPath = path.join(musicDir, savedMusicName);
          await fs.rename(musicFile.path, savedMusicPath);
          const musicDurationMs = await probeAudioDurationMs(savedMusicPath);
          backgroundMusic = {
            filename: musicFile.originalname,
            url: `/api/media/${projectId}/music/${savedMusicName}`,
            durationMs: musicDurationMs,
            volumeDb: musicVolumeDb,
            duckingEnabled: musicDucking,
          };
        }

        // Generate compact 16kHz mono MP3 proxy for Gemini acoustic alignment when needed
        let audioProxyPath: string | undefined;
        if (matchingPreference !== 'local' && isGeminiConfigured()) {
          try {
            const proxyPath = path.join(audioDir, 'gemini_proxy.mp3');
            await createGeminiAudioProxy(savedAudioPath, proxyPath);
            audioProxyPath = proxyPath;
          } catch {
            audioProxyPath = undefined;
          }
        }

        const mediaById = new Map<string, { path: string; mediaType: MediaType }>();
        const thumbPathsById = new Map<string, string>();
        const processedMedia: Array<{
          id: string;
          originalName: string;
          mediaType: MediaType;
          clipDurationMs?: number;
          url: string;
          thumbUrl: string;
          thumbPath: string;
          width: number;
          height: number;
        }> = [];

        for (let i = 0; i < mediaFiles.length; i++) {
          const mFile = mediaFiles[i];
          const mediaId = `media_${String(i + 1).padStart(2, '0')}_${crypto.randomBytes(2).toString('hex')}`;
          const mExt = getSafeExtension(mFile.originalname, '.jpg');
          const savedName = `${mediaId}${mExt}`;
          const savedPath = path.join(mediaDir, savedName);
          await fs.rename(mFile.path, savedPath);

          const meta = await processUploadedMedia(
            savedPath,
            thumbsDir,
            mediaId,
            mFile.originalname
          );
          mediaById.set(mediaId, { path: savedPath, mediaType: meta.mediaType });
          thumbPathsById.set(mediaId, meta.thumbPath);

          processedMedia.push({
            id: mediaId,
            originalName: mFile.originalname,
            mediaType: meta.mediaType,
            clipDurationMs: meta.clipDurationMs,
            url: `/api/media/${projectId}/images/${savedName}`,
            thumbUrl: `/api/media/${projectId}/thumbs/${mediaId}.jpg`,
            thumbPath: meta.thumbPath,
            width: meta.width,
            height: meta.height,
          });
        }

        const alignment = await alignScriptAndImages({
          rawScript,
          audioDurationMs: audioAnalysis.durationMs,
          audioProxyPath,
          pauses: audioAnalysis.pauses,
          images: processedMedia,
          matchingPreference,
          pacingMode,
          graphicCardTheme,
        });

        const serializedImages = serializeImagesWithSummaries(
          processedMedia,
          alignment.imageSummaries
        );

        const mergedScenes = alignment.scenes.map((scene, idx) => {
          const hint = sceneHints[idx];
          if (!hint) return scene;
          return {
            ...scene,
            kicker: (hint.kicker ?? '').trim() || scene.kicker,
            accentPhrase: (hint.accentPhrase ?? '').trim() || scene.accentPhrase,
            sfxCue: sanitizeHintSfxCue(hint.sfxCue, scene.sfxCue),
            imagePrompt: (hint.imagePrompt ?? '').trim() || scene.imagePrompt,
            beatKind: hint.beatKind ?? scene.beatKind,
            graphicCard: hint.graphicCard ?? scene.graphicCard,
          };
        });

        const session: ProjectSession = {
          id: projectId,
          createdAt: new Date().toISOString(),
          aspectRatio,
          pacingMode,
          motionIntensity,
          transitionStyle,
          transitionDurationMs: transitionStyle === 'whip-dynamic' ? 140 : 280,
          subtitlesEnabled,
          captionMode,
          textEffect,
          fontStyle,
          accentColor,
          brandKicker,
          sfxConfig,
          matchingEngineUsed: alignment.engineUsed,
          fallbackNotice: alignment.fallbackNotice,
          audio: {
            filename: audioFile.originalname,
            url: `/api/media/${projectId}/audio/${savedAudioName}`,
            durationMs: audioAnalysis.durationMs,
            sampleRate: audioAnalysis.sampleRate,
            channels: audioAnalysis.channels,
            codec: audioAnalysis.codec,
            waveformPeaks: audioAnalysis.waveformPeaks,
            pauses: audioAnalysis.pauses,
          },
          backgroundMusic,
          rawScript,
          images: serializedImages,
          scenes: mergedScenes,
        };

        projects.set(projectId, {
          session,
          projectDir,
          audioPath: savedAudioPath,
          musicPath: savedMusicPath,
          mediaById,
          thumbPathsById,
        });

        res.json(session);
      } catch (err: unknown) {
        const toClean = [
          ...(audioFile ? [audioFile.path] : []),
          ...(musicFile ? [musicFile.path] : []),
          ...mediaFiles.map((f) => f.path),
        ];
        await Promise.all(toClean.map((p) => fs.rm(p, { force: true }).catch(() => {})));

        const message = err instanceof Error ? err.message : 'Analysis failed.';
        res.status(500).json({ error: message });
      }
    }
  );

  // 4. One-click Sample Story generator
  router.post('/sample', async (req, res) => {
    try {
      const aspectRatio = sanitizeAspectRatio(req.body?.aspectRatio);
      const pacingMode = sanitizePacingMode(req.body?.pacingMode);
      const graphicCardTheme = sanitizeGraphicCardTheme(req.body?.graphicCardTheme);
      const motionIntensity = sanitizeMotionIntensity(req.body?.motionIntensity);
      const matchingPreference = sanitizeMatchingPreference(req.body?.matchingPreference);
      // Built-in sample is a non-vision demo. Keep it usable when the PC has
      // no model, without silently mislabeling a REAL user's automatic sync.
      const sampleVision = await getOllamaVisionStatus();
      const sampleMatchingPreference = matchingPreference === 'auto' &&
        !isGeminiConfigured() && !sampleVision.available
          ? 'local' : matchingPreference;
      const transitionStyle = sanitizeTransitionStyle(req.body?.transitionStyle);
      const captionMode = sanitizeCaptionMode(
        req.body?.captionMode,
        sanitizeBoolean(req.body?.subtitlesEnabled, true) ? 'explainer-kinetic' : 'off'
      );
      const subtitlesEnabled = captionMode !== 'off';
      const textEffect = sanitizeTextEffect(req.body?.textEffect, 'type-reveal');
      const fontStyle = sanitizeFontStyle(req.body?.fontStyle, 'modern-sans');
      const accentColor = sanitizeAccentColor(req.body?.accentColor, 'coral');
      const brandKicker = String(req.body?.brandKicker ?? '@scenesync.studio').trim().slice(0, 48);
      const sfxConfig = sanitizeSfxConfig(req.body?.sfxConfig, DEFAULT_SFX_CONFIG);

      const projectId = 'sample_' + crypto.randomBytes(4).toString('hex');
      const projectDir = path.join(WORKSPACE_ROOT, projectId);
      const audioDir = path.join(projectDir, 'audio');
      const imagesDir = path.join(projectDir, 'images');
      const thumbsDir = path.join(projectDir, 'thumbs');

      await Promise.all([
        fs.mkdir(audioDir, { recursive: true }),
        fs.mkdir(imagesDir, { recursive: true }),
        fs.mkdir(thumbsDir, { recursive: true }),
      ]);

      const sampleAudioName = 'sample_voiceover_cadence.wav';
      const sampleAudioPath = path.join(audioDir, sampleAudioName);
      await generateSampleAudioWav(sampleAudioPath);

      const audioAnalysis = await analyzeAudioTrack(sampleAudioPath);
      const sampleImgs = await copySampleImagesToDir(imagesDir);

      let audioProxyPath: string | undefined;
      if (matchingPreference !== 'local' && isGeminiConfigured()) {
        try {
          const proxyPath = path.join(audioDir, 'gemini_proxy.mp3');
          await createGeminiAudioProxy(sampleAudioPath, proxyPath);
          audioProxyPath = proxyPath;
        } catch {
          audioProxyPath = undefined;
        }
      }

      const mediaById = new Map<string, { path: string; mediaType: MediaType }>();
      const thumbPathsById = new Map<string, string>();
      const processedMedia: Array<{
        id: string;
        originalName: string;
        mediaType: MediaType;
        clipDurationMs?: number;
        url: string;
        thumbUrl: string;
        thumbPath: string;
        width: number;
        height: number;
      }> = [];

      for (let i = 0; i < sampleImgs.length; i++) {
        const sImg = sampleImgs[i];
        const mediaId = `media_${String(i + 1).padStart(2, '0')}_${crypto.randomBytes(2).toString('hex')}`;
        const savedName = path.basename(sImg.path);
        const meta = await processUploadedMedia(
          sImg.path,
          thumbsDir,
          mediaId,
          sImg.originalName
        );
        mediaById.set(mediaId, { path: sImg.path, mediaType: meta.mediaType });
        thumbPathsById.set(mediaId, meta.thumbPath);

        processedMedia.push({
          id: mediaId,
          originalName: sImg.originalName,
          mediaType: meta.mediaType,
          clipDurationMs: meta.clipDurationMs,
          url: `/api/media/${projectId}/images/${savedName}`,
          thumbUrl: `/api/media/${projectId}/thumbs/${mediaId}.jpg`,
          thumbPath: meta.thumbPath,
          width: meta.width,
          height: meta.height,
        });
      }

      const alignment = await alignScriptAndImages({
        rawScript: SAMPLE_SCRIPT,
        audioDurationMs: audioAnalysis.durationMs,
        audioProxyPath,
        pauses: audioAnalysis.pauses,
        images: processedMedia,
        matchingPreference: sampleMatchingPreference,
        pacingMode,
        graphicCardTheme,
      });

      const serializedImages = serializeImagesWithSummaries(
        processedMedia,
        alignment.imageSummaries
      );

      const session: ProjectSession = {
        id: projectId,
        createdAt: new Date().toISOString(),
        aspectRatio,
        pacingMode,
        motionIntensity,
        transitionStyle,
        transitionDurationMs: transitionStyle === 'whip-dynamic' ? 140 : 280,
        subtitlesEnabled,
        captionMode,
        textEffect,
        fontStyle,
        accentColor,
        brandKicker,
        sfxConfig,
        matchingEngineUsed: alignment.engineUsed,
        fallbackNotice: alignment.fallbackNotice,
        audio: {
          filename: sampleAudioName,
          url: `/api/media/${projectId}/audio/${sampleAudioName}`,
          durationMs: audioAnalysis.durationMs,
          sampleRate: audioAnalysis.sampleRate,
          channels: audioAnalysis.channels,
          codec: audioAnalysis.codec,
          waveformPeaks: audioAnalysis.waveformPeaks,
          pauses: audioAnalysis.pauses,
        },
        rawScript: SAMPLE_SCRIPT,
        images: serializedImages,
        scenes: alignment.scenes,
      };

      projects.set(projectId, {
        session,
        projectDir,
        audioPath: sampleAudioPath,
        mediaById,
        thumbPathsById,
      });

      res.json(session);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create sample project.';
      res.status(500).json({ error: message });
    }
  });

  // 5. Persist scene swaps, split/merge/reorder, transitions, subtitles, music config, or recalculate timings
  router.post('/projects/:id/realign', (req, res) => {
    const stored = projects.get(req.params.id);
    if (!stored) {
      res.status(404).json({ error: 'Project session not found.' });
      return;
    }

    const {
      aspectRatio,
      motionIntensity,
      transitionStyle,
      subtitlesEnabled,
      captionMode,
      textEffect,
      fontStyle,
      accentColor,
      brandKicker,
      sfxConfig,
      backgroundMusic,
      scenes,
      recalculateTimings,
    } = req.body as {
      aspectRatio?: AspectRatio;
      motionIntensity?: MotionIntensity;
      transitionStyle?: TransitionStyle;
      subtitlesEnabled?: boolean;
      captionMode?: CaptionMode;
      textEffect?: TextEffectId;
      fontStyle?: FontStyleId;
      accentColor?: AccentColorId;
      brandKicker?: string;
      sfxConfig?: SfxConfig;
      backgroundMusic?: BackgroundMusicTrack | null;
      scenes?: SceneItem[];
      recalculateTimings?: boolean;
    };

    if (aspectRatio) stored.session.aspectRatio = sanitizeAspectRatio(aspectRatio);
    if (motionIntensity) stored.session.motionIntensity = sanitizeMotionIntensity(motionIntensity);
    if (transitionStyle) stored.session.transitionStyle = sanitizeTransitionStyle(transitionStyle);
    if (captionMode) {
      stored.session.captionMode = sanitizeCaptionMode(captionMode, stored.session.captionMode);
      stored.session.subtitlesEnabled = stored.session.captionMode !== 'off';
    } else if (typeof subtitlesEnabled === 'boolean') {
      stored.session.subtitlesEnabled = subtitlesEnabled;
      if (!subtitlesEnabled) stored.session.captionMode = 'off';
      else if (stored.session.captionMode === 'off') stored.session.captionMode = 'explainer-kinetic';
    }
    if (textEffect) stored.session.textEffect = sanitizeTextEffect(textEffect, stored.session.textEffect);
    if (fontStyle) stored.session.fontStyle = sanitizeFontStyle(fontStyle, stored.session.fontStyle);
    if (accentColor) stored.session.accentColor = sanitizeAccentColor(accentColor, stored.session.accentColor);
    if (typeof brandKicker === 'string') stored.session.brandKicker = brandKicker.trim().slice(0, 48);
    if (sfxConfig) stored.session.sfxConfig = sanitizeSfxConfig(sfxConfig, stored.session.sfxConfig);

    if (backgroundMusic === null) {
      stored.session.backgroundMusic = undefined;
      stored.musicPath = undefined;
    } else if (backgroundMusic && stored.session.backgroundMusic) {
      stored.session.backgroundMusic = {
        ...stored.session.backgroundMusic,
        volumeDb: sanitizeVolumeDb(backgroundMusic.volumeDb, stored.session.backgroundMusic.volumeDb),
        duckingEnabled: Boolean(backgroundMusic.duckingEnabled),
      };
    }

    if (Array.isArray(scenes) && scenes.length > 0) {
      if (recalculateTimings) {
        stored.session.scenes = computeDynamicSceneTimings(
          scenes.map((s) => ({
            id: s.id,
            text: s.text,
            imageId: s.imageId,
            matchReason: s.matchReason,
            emotionalWeight: s.emotionalWeight,
            kenBurnsDirection: s.kenBurnsDirection,
            beatKind: s.beatKind,
            focalCrop: s.focalCrop,
            graphicCard: s.graphicCard,
            captionZone: s.captionZone,
            kicker: s.kicker,
            accentPhrase: s.accentPhrase,
            sfxCue: s.sfxCue,
            imagePrompt: s.imagePrompt,
          })),
          stored.session.audio.durationMs,
          stored.session.audio.pauses
        );
      } else {
        stored.session.scenes = scenes.map((s, idx) => ({ ...s, index: idx }));
      }
    }

    res.json(stored.session);
  });

  // 6. Upload or replace background music bed on an existing project
  router.post('/projects/:id/music', upload.single('music'), async (req, res) => {
    const stored = projects.get(req.params.id);
    if (!stored) {
      if (req.file) await fs.rm(req.file.path, { force: true }).catch(() => {});
      res.status(404).json({ error: 'Project session not found.' });
      return;
    }

    if (!req.file) {
      res.status(400).json({ error: 'No music file provided.' });
      return;
    }

    try {
      const musicDir = path.join(stored.projectDir, 'music');
      await fs.mkdir(musicDir, { recursive: true });
      const musicExt = getSafeExtension(req.file.originalname, '.mp3');
      const savedName = `music_bed_${Date.now()}${musicExt}`;
      const savedPath = path.join(musicDir, savedName);
      await fs.rename(req.file.path, savedPath);

      const durationMs = await probeAudioDurationMs(savedPath);
      const volumeDb = sanitizeVolumeDb(req.body?.volumeDb, -14);
      const duckingEnabled = sanitizeBoolean(req.body?.duckingEnabled, true);

      stored.musicPath = savedPath;
      stored.session.backgroundMusic = {
        filename: req.file.originalname,
        url: `/api/media/${stored.session.id}/music/${savedName}`,
        durationMs,
        volumeDb,
        duckingEnabled,
      };

      res.json(stored.session);
    } catch (err: unknown) {
      await fs.rm(req.file.path, { force: true }).catch(() => {});
      const message = err instanceof Error ? err.message : 'Failed to process background music.';
      res.status(500).json({ error: message });
    }
  });

  // 7. Start 1080p MP4 export job
  router.post('/projects/:id/export', async (req, res) => {
    const stored = projects.get(req.params.id);
    if (!stored) {
      res.status(404).json({ error: 'Project session not found.' });
      return;
    }

    const requestedEncoder = typeof req.body?.encoderId === 'string' ? req.body.encoderId : '';
    const aspectRatio = sanitizeAspectRatio(req.body?.aspectRatio ?? stored.session.aspectRatio);
    const motionIntensity = sanitizeMotionIntensity(
      req.body?.motionIntensity ?? stored.session.motionIntensity
    );
    const transitionStyle = sanitizeTransitionStyle(
      req.body?.transitionStyle ?? stored.session.transitionStyle
    );
    const captionMode = sanitizeCaptionMode(
      req.body?.captionMode,
      stored.session.captionMode
    );
    const subtitlesEnabled =
      captionMode !== 'off' &&
      sanitizeBoolean(req.body?.subtitlesEnabled, stored.session.subtitlesEnabled);
    const textEffect = sanitizeTextEffect(req.body?.textEffect, stored.session.textEffect);
    const fontStyle = sanitizeFontStyle(req.body?.fontStyle, stored.session.fontStyle);
    const accentColor = sanitizeAccentColor(req.body?.accentColor, stored.session.accentColor);
    const brandKicker =
      typeof req.body?.brandKicker === 'string'
        ? req.body.brandKicker.trim().slice(0, 48)
        : stored.session.brandKicker;
    const sfxConfig = sanitizeSfxConfig(req.body?.sfxConfig, stored.session.sfxConfig);
    const scenes =
      Array.isArray(req.body?.scenes) && req.body.scenes.length > 0
        ? (req.body.scenes as SceneItem[])
        : stored.session.scenes;

    stored.session.aspectRatio = aspectRatio;
    stored.session.motionIntensity = motionIntensity;
    stored.session.transitionStyle = transitionStyle;
    stored.session.captionMode = captionMode;
    stored.session.subtitlesEnabled = subtitlesEnabled;
    stored.session.textEffect = textEffect;
    stored.session.fontStyle = fontStyle;
    stored.session.accentColor = accentColor;
    stored.session.brandKicker = brandKicker;
    stored.session.sfxConfig = sfxConfig;
    stored.session.scenes = scenes;

    const encoderInfo = await probeEncoders();
    const validIds = new Set(encoderInfo.availableEncoders.map((e) => e.id));
    const chosenEncoder = validIds.has(requestedEncoder)
      ? requestedEncoder
      : encoderInfo.recommendedEncoder.id;

    const jobId = crypto.randomBytes(5).toString('hex');
    const emitter = new NodeEventEmitter();

    const initialState: RenderJobState = {
      jobId,
      projectId: stored.session.id,
      status: 'queued',
      progress: 1,
      currentScene: 0,
      totalScenes: scenes.length,
      stage: 'Queued for rendering',
      message: `Preparing ${aspectRatio} 1080p render via ${chosenEncoder}...`,
      encoderUsed: chosenEncoder,
      elapsedMs: 0,
    };

    const jobRecord: StoredJob = {
      state: initialState,
      emitter,
    };
    jobs.set(jobId, jobRecord);

    void renderProjectMp4({
      jobId,
      projectId: stored.session.id,
      projectDir: stored.projectDir,
      sfxDir: SFX_BANK_DIR,
      audioPath: stored.audioPath,
      audioDurationMs: stored.session.audio.durationMs,
      musicPath: stored.musicPath,
      backgroundMusic: stored.session.backgroundMusic,
      aspectRatio,
      motionIntensity,
      transitionStyle,
      transitionDurationMs: stored.session.transitionDurationMs,
      subtitlesEnabled,
      captionMode,
      textEffect,
      fontStyle,
      accentColor,
      brandKicker,
      sfxConfig,
      encoderId: chosenEncoder,
      scenes,
      mediaById: stored.mediaById,
      onProgress: (nextState) => {
        jobRecord.state = nextState;
        emitter.emit('progress', nextState);
        if (nextState.status === 'completed' || nextState.status === 'failed') {
          void persistJobMetadata(jobRecord);
        }
      },
    })
      .then((outputPath) => {
        jobRecord.outputPath = outputPath;
        void persistJobMetadata(jobRecord);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'FFmpeg render failed.';
        jobRecord.state = {
          ...jobRecord.state,
          status: 'failed',
          stage: 'Render failed',
          message: msg,
          error: msg,
        };
        void persistJobMetadata(jobRecord);
        emitter.emit('progress', jobRecord.state);
      });

    res.json({ jobId, state: initialState });
  });

  // 7b. Recover most recent completed MP4 export from disk (survives page reload/restart & finds pre-existing renders)
  router.get('/exports/recent', async (_req, res) => {
    try {
      await fs.mkdir(JOBS_META_DIR, { recursive: true });
      const byJobId = new Map<string, { mtimeMs: number; state: RenderJobState }>();

      const metaFiles = await fs.readdir(JOBS_META_DIR).catch(() => []);
      for (const file of metaFiles) {
        if (!file.endsWith('.json')) continue;
        try {
          const fullJson = path.join(JOBS_META_DIR, file);
          const parsed = JSON.parse(await fs.readFile(fullJson, 'utf8')) as {
            state?: RenderJobState;
            outputPath?: string;
          };
          if (parsed.state?.status === 'completed' && parsed.outputPath) {
            const vidStat = await fs.stat(parsed.outputPath);
            parsed.state.fileSizeBytes = vidStat.size;
            byJobId.set(parsed.state.jobId, {
              mtimeMs: vidStat.mtimeMs,
              state: parsed.state,
            });
          }
        } catch {
          // Ignore stale/deleted files
        }
      }

      const projectDirs = await fs.readdir(WORKSPACE_ROOT, { withFileTypes: true }).catch(() => []);
      for (const dirEntry of projectDirs) {
        if (!dirEntry.isDirectory() || dirEntry.name.startsWith('_')) continue;
        const projPath = path.join(WORKSPACE_ROOT, dirEntry.name);
        const files = await fs.readdir(projPath).catch(() => []);
        for (const f of files) {
          const m = /^scenesync_([a-zA-Z0-9_-]+)_([a-zA-Z0-9_-]+)\.mp4$/.exec(f);
          if (!m) continue;
          const jobId = m[2];
          if (byJobId.has(jobId)) continue;
          try {
            const vidStat = await fs.stat(path.join(projPath, f));
            byJobId.set(jobId, {
              mtimeMs: vidStat.mtimeMs,
              state: {
                jobId,
                projectId: m[1],
                status: 'completed',
                progress: 100,
                currentScene: 1,
                totalScenes: 1,
                stage: 'Export complete',
                message: 'Recovered mastered 1080p MP4 from workspace storage.',
                encoderUsed: 'libx264',
                elapsedMs: 0,
                outputUrl: `/api/jobs/${jobId}/download`,
                fileSizeBytes: vidStat.size,
              },
            });
          } catch {
            // Skip unreadable file
          }
        }
      }

      const completed = Array.from(byJobId.values()).sort((a, b) => b.mtimeMs - a.mtimeMs);
      res.json({ latest: completed[0]?.state ?? null });
    } catch {
      res.json({ latest: null });
    }
  });

  // 8. Job status polling (with disk recovery fallback)
  router.get('/jobs/:jobId', async (req, res) => {
    const job = await resolveJobRecord(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Render job not found.' });
      return;
    }
    res.json(job.state);
  });

  // 9. SSE live render progress stream
  router.get('/jobs/:jobId/events', async (req, res) => {
    const job = await resolveJobRecord(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Render job not found.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (state: RenderJobState) => {
      res.write(`data: ${JSON.stringify(state)}\n\n`);
      if (state.status === 'completed' || state.status === 'failed') {
        res.end();
      }
    };

    sendEvent(job.state);

    if (job.state.status !== 'completed' && job.state.status !== 'failed') {
      const listener = (state: RenderJobState) => sendEvent(state);
      job.emitter.on('progress', listener);
      req.on('close', () => {
        job.emitter.off('progress', listener);
      });
    }
  });

  // 10a. Chunked binary download endpoint (<= 8MB slices so large 60MB+ videos never hit Cloud Run's 32MB response cap)
  router.get('/jobs/:jobId/chunk', async (req, res) => {
    const job = await resolveJobRecord(req.params.jobId);
    if (!job || !job.outputPath) {
      res.status(404).json({ error: 'Rendered video file not available yet.' });
      return;
    }

    let handle: fs.FileHandle | null = null;
    try {
      const stat = await fs.stat(job.outputPath);
      const totalSize = stat.size;
      const offsetRaw = Number(req.query.offset ?? 0);
      const lengthRaw = Number(req.query.length ?? 5 * 1024 * 1024);

      const offset = Number.isFinite(offsetRaw)
        ? Math.max(0, Math.min(totalSize, Math.floor(offsetRaw)))
        : 0;
      const maxSlice = 8 * 1024 * 1024;
      const length = Number.isFinite(lengthRaw)
        ? Math.max(1, Math.min(maxSlice, Math.floor(lengthRaw)))
        : 5 * 1024 * 1024;

      const toRead = Math.max(0, Math.min(length, totalSize - offset));
      const buf = Buffer.allocUnsafe(toRead);
      if (toRead > 0) {
        handle = await fs.open(job.outputPath, 'r');
        const { bytesRead } = await handle.read(buf, 0, toRead, offset);
        const slice = bytesRead === toRead ? buf : buf.subarray(0, bytesRead);
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('X-Total-Bytes', String(totalSize));
        res.setHeader('X-Chunk-Offset', String(offset));
        res.setHeader('X-Chunk-Length', String(slice.byteLength));
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).send(slice);
      } else {
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('X-Total-Bytes', String(totalSize));
        res.setHeader('X-Chunk-Offset', String(offset));
        res.setHeader('X-Chunk-Length', '0');
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).send(Buffer.alloc(0));
      }
    } catch {
      res.status(404).json({ error: 'Rendered file missing from workspace.' });
    } finally {
      await handle?.close().catch(() => {});
    }
  });

  // 10b. Direct MP4 download (with disk recovery fallback for local/small downloads)
  router.get('/jobs/:jobId/download', async (req, res) => {
    const job = await resolveJobRecord(req.params.jobId);
    if (!job || !job.outputPath) {
      res.status(404).json({ error: 'Rendered video file not available yet.' });
      return;
    }
    try {
      await fs.access(job.outputPath);
      res.download(job.outputPath, `scenesync_${job.state.projectId}_1080p.mp4`);
    } catch {
      res.status(404).json({ error: 'Rendered file missing from workspace.' });
    }
  });

  // 11. Download Windows one-click batch launcher
  router.get('/launcher/bat', async (_req, res) => {
    const batPath = path.resolve(process.cwd(), 'launch-studio.bat');
    try {
      await fs.access(batPath);
      res.download(batPath, 'launch-studio.bat');
    } catch {
      res.status(404).json({ error: 'Launcher batch file not found.' });
    }
  });

  return router;
}
