import { createDirectorDemo } from '../services/directorDemo.ts';
import { planMotion, estimateWords, emphasisFrom } from '../../src/director/planner.ts';
import { fileURLToPath } from 'node:url';
import { RenderQueue } from '../services/renderQueue.ts';
import { spawn } from 'node:child_process';
import { directSession } from '../services/directorEngine.ts';
import { getSpeechStatus } from '../services/speechAligner.ts';
import { saveProject, loadProject, listProjects, type ProjectRecord } from '../services/projectStore.ts';
import { DIRECTOR_PRESETS } from '../../src/director/types.ts';
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
import { getGeminiClient, getGeminiVisionModel, isGeminiConfigured } from '../services/geminiClient.ts';
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

type StoredProject = ProjectRecord;

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
  totalChunks:number;
  chunkHashes:string[];
  bytes:number;
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
async function storeProject(record:StoredProject):Promise<void> {
  if(record.session.backgroundMusic?.filename==='SceneSync original underscore')record.musicPath=path.join(record.projectDir,'music',path.basename(record.session.backgroundMusic.url));
  await saveProject(record);projects.set(record.session.id,record);
}
async function getProject(id:string):Promise<StoredProject|undefined> {
  const existing=projects.get(id);if(existing)return existing;
  const record=await loadProject(WORKSPACE_ROOT,id);if(record)projects.set(id,record);return record;
}
const jobs = new Map<string, StoredJob>();
const renderQueue=new RenderQueue();
const renderControllers=new Map<string,AbortController>();
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
  await fs.mkdir(JOBS_META_DIR, { recursive: true });
  const safeId = job.state.jobId.replace(/[^a-zA-Z0-9_-]/g, '');
  const target = path.join(JOBS_META_DIR, `${safeId}.json`);
  const temporary = `${target}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  try {
    await fs.writeFile(temporary, JSON.stringify({ state: job.state, outputPath: job.outputPath }), 'utf8');
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true }).catch(() => {});
  }
}

async function resolveJobRecord(jobId: string): Promise<StoredJob | undefined> {
  if (!/^[a-zA-Z0-9_-]+$/.test(jobId)) return undefined;
  const mem = jobs.get(jobId);
  if (mem) return mem;
  try {
    const raw = await fs.readFile(path.join(JOBS_META_DIR, `${jobId}.json`), 'utf8');
    const parsed = JSON.parse(raw) as { state?: RenderJobState; outputPath?: string };
    if (!parsed.state || parsed.state.jobId !== jobId) return undefined;
    let outputPath = parsed.outputPath;
    let failure: string | undefined;
    if (parsed.state.status === 'completed') {
      try {
        if (!outputPath) throw new Error('Missing output path');
        const stat = await fs.stat(outputPath);
        if (stat.size === 0) throw new Error('Empty output');
        parsed.state.fileSizeBytes = stat.size;
      } catch {
        failure = 'Completed export file is missing. Export the project again.';
      }
    } else if (parsed.state.status !== 'failed' && parsed.state.status !== 'cancelled') {
      failure = 'Render interrupted by an application restart. Export the project again.';
    }
    if (failure) {
      parsed.state = { ...parsed.state, status: 'failed', stage: 'Render unavailable',
        message: failure, error: failure, outputUrl: undefined, fileSizeBytes: undefined };
    }
    if (parsed.state.status !== 'completed') outputPath = undefined;
    const restored = { state: parsed.state, outputPath, emitter: new NodeEventEmitter() };
    jobs.set(jobId, restored);
    return restored;
  } catch {
    return undefined;
  }
  // An MP4 filename is not proof of a successful render. In particular, never
  // resurrect failed/partial output by scanning project directories.
}

void ensureDirs();

const upload = multer({
  dest: UPLOAD_TMP_DIR,
  limits: {
    fileSize: 350 * 1024 * 1024,
    files: 152,
  },
});

const chunkUpload=multer({dest:UPLOAD_TMP_DIR,limits:{fileSize:8*1024*1024,files:1}});

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

  router.get('/director/presets', (_req,res)=>res.json({presets:DIRECTOR_PRESETS}));
  router.get('/projects', async (_req,res)=>res.json({projects:await listProjects(WORKSPACE_ROOT)}));
  router.get('/projects/:id', async (req,res)=>{
    const stored=await getProject(req.params.id);
    if(!stored){res.status(404).json({error:'Saved project not found.'});return;}
    res.json(stored.session);
  });
  router.post('/projects/:id/direct', async (req,res)=>{
    try {
      const stored=await getProject(req.params.id);
      if(!stored){res.status(404).json({error:'Saved project not found.'});return;}
      stored.session=await directSession(stored.session,stored.audioPath,req.body?.settings??stored.session.directorSettings);
      if(stored.session.backgroundMusic?.filename==='SceneSync original underscore')stored.musicPath=path.join(stored.projectDir,'music',path.basename(stored.session.backgroundMusic.url));
      await saveProject(stored);res.json(stored.session);
    }catch(error){res.status(400).json({error:error instanceof Error?error.message:'Direction failed.'});}
  });
  // Setup is user-triggered. Install packages/model inside workspace_data only.
  let speechSetup:{status:string;message:string}={status:'idle',message:''};
  router.get('/speech/setup',(_req,res)=>res.json(speechSetup));
  router.post('/speech/setup',(_req,res)=>{
    if(speechSetup.status==='running'){res.json(speechSetup);return;}
    speechSetup={status:'running',message:'Installing local speech alignment and downloading the model…'};
    const child=spawn(process.execPath,[fileURLToPath(new URL('../../scripts/setup-speech.mjs',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','pipe']});
    let log='';
    const update=(chunk:Buffer)=>{log=(log+chunk.toString()).slice(-2500);speechSetup.message=log.split(/\r?\n/).filter(Boolean).at(-1)??speechSetup.message;};
    child.stdout.on('data',update);child.stderr.on('data',update);
    child.on('error',error=>{speechSetup={status:'failed',message:error.message};});
    child.on('close',code=>{speechSetup={status:code===0?'completed':'failed',message:code===0?'Local speech alignment is ready.':log||'Install Python 3.10–3.12 and retry speech setup.'};});
    res.json(speechSetup);
  });

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
      const [encoderInfo, ollama, speech] = await Promise.all([probeEncoders(), getOllamaVisionStatus(), getSpeechStatus()]);
      res.json({
        speech,
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

  // Test the configured server-side key without returning or logging the secret.
  // This is intentionally user-triggered, to avoid billable API calls on page load.
  router.post('/gemini/check', async (_req, res) => {
    const client = getGeminiClient();
    if (!client) {
      res.status(400).json({
        ok: false,
        message: 'No Gemini API key is configured on the SceneSync server. Add a newly rotated key to your local .env file and restart SceneSync.',
      });
      return;
    }

    const model = getGeminiVisionModel();
    try {
      await client.models.generateContent({
        model,
        contents: 'Reply with OK.',
        config: { maxOutputTokens: 16 },
      });
      res.json({ ok: true, model, message: 'Gemini connection verified. Auto Vision can use the configured server-side key.' });
    } catch (err: unknown) {
      // Never relay raw provider errors, which can sometimes include sensitive URLs.
      const reason = err instanceof Error ? err.message : '';
      const message = /api.key|api_key|invalid.key|unauthori[sz]ed|401|403/i.test(reason)
        ? 'Gemini rejected this API key. Rotate it in Google AI Studio and update your local .env.'
        : /quota|rate.limit|429|resource.exhausted/i.test(reason)
          ? 'Gemini quota or rate limit reached for this key. Review your Google AI Studio usage.'
          : /not.found|404|model/i.test(reason)
            ? 'Gemini could not access the selected vision model. Check GEMINI_VISION_MODEL and your project model access.'
            : 'Could not verify Gemini. Check connectivity, your API key, and model access.';
      res.status(502).json({ ok: false, model, message });
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
  router.post('/uploads/:uploadId/chunk', chunkUpload.single('chunk'), async (req, res) => {
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
      const chunkIndex = Number(req.body?.chunkIndex ?? 0);
      const totalChunks = Number(req.body?.totalChunks ?? 1);
      const orderIndex = Number(req.body?.orderIndex ?? 0);
      if(!Number.isInteger(chunkIndex)||!Number.isInteger(totalChunks)||chunkIndex<0||totalChunks<1||totalChunks>4096||chunkIndex>=totalChunks||!Number.isInteger(orderIndex)||orderIndex<0)throw new Error('Invalid upload chunk sequence.');
      const ext=getSafeExtension(originalName,role==='audio'||role==='music'?'.mp3':'.jpg');
      const destPath=path.join(staged.stagingDir,`${role}_${fileKey}${ext}`);
      const chunkBuf=await fs.readFile(chunkFile.path);
      await fs.rm(chunkFile.path,{force:true});
      const hash=crypto.createHash('sha256').update(chunkBuf).digest('hex');
      const prior=staged.filesByKey.get(fileKey);
      if(prior&&(prior.originalName!==originalName||prior.role!==role||prior.totalChunks!==totalChunks))throw new Error('Upload file identity changed during transfer. Restart this upload.');
      if(prior && chunkIndex<prior.chunkHashes.length){
        if(prior.chunkHashes[chunkIndex]!==hash)throw new Error('Retried chunk contains different bytes. Restart this upload.');
        res.json({ok:true,fileKey,chunkIndex,repeated:true});return;
      }
      if(chunkIndex!==(prior?.chunkHashes.length??0))throw new Error('Upload chunk arrived out of order. Retry the missing chunk.');
      if((prior?.bytes??0)+chunkBuf.length>350*1024*1024)throw new Error('Uploaded file exceeds 350 MB.');
      if(!prior&&staged.filesByKey.size>=152)throw new Error('Maximum upload is 150 visuals plus voiceover and music.');
      if(!prior)await fs.writeFile(destPath,chunkBuf);else await fs.appendFile(destPath,chunkBuf);
      staged.filesByKey.set(fileKey,{fileKey,originalName,role,filePath:destPath,orderIndex,totalChunks,chunkHashes:[...(prior?.chunkHashes??[]),hash],bytes:(prior?.bytes??0)+chunkBuf.length});

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

    if([...staged.filesByKey.values()].some(file=>file.chunkHashes.length!==file.totalChunks)){
      res.status(400).json({error:'Some upload chunks are missing. Complete all files before generating the reel.'});return;
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
            source:'uploaded',
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

        let session: ProjectSession = {
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

        session = await directSession(session, savedAudioPath, typeof req.body?.directorSettings === 'string' ? JSON.parse(req.body.directorSettings) : req.body?.directorSettings ?? {enabled:false}, message => {
          if (typeof jobState !== 'undefined') {jobState.message=message;jobState.progress=92;}
        });
        await storeProject({
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
    const stored = await getProject(projectId);
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
      { name: 'images', maxCount: 150 },
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
            source:'uploaded',
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

        let session: ProjectSession = {
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

        session = await directSession(session, savedAudioPath, typeof req.body?.directorSettings === 'string' ? JSON.parse(req.body.directorSettings) : req.body?.directorSettings ?? {enabled:false});
        await storeProject({
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
      if(req.body?.directorSettings?.enabled){const demo=await createDirectorDemo(WORKSPACE_ROOT,req.body.directorSettings,sanitizeAspectRatio(req.body?.aspectRatio));await storeProject(demo);res.json(demo.session);return;}
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

      let session: ProjectSession = {
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

      session = await directSession(session, sampleAudioPath, {...(req.body?.directorSettings ?? {enabled:false}),alignment:'estimated'});
      await storeProject({
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
  router.post('/projects/:id/realign', async (req, res) => {
    const stored = await getProject(req.params.id);
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

    const beforeScenes=stored.session.scenes;
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

    if(stored.session.directorSettings?.enabled){
      if(recalculateTimings){
        const plan=planMotion(stored.session.scenes,stored.session.directorSettings.preset,{engine:'estimated',coverage:0,words:estimateWords(stored.session.scenes),notice:'Manual timeline recalculation replaced speech anchors; regenerate direction to align again.'});
        stored.session.scenes=plan.scenes;stored.session.directorReport=plan.report;
      }else{
        let wordsChanged=false;
        stored.session.scenes=stored.session.scenes.map(scene=>{
          const prior=beforeScenes.find(s=>s.id===scene.id);
          if(!scene.motion||!prior)return scene;
          const changed=prior.text!==scene.text||prior.startMs!==scene.startMs||prior.endMs!==scene.endMs;
          const cardChanged=JSON.stringify(prior.graphicCard)!==JSON.stringify(scene.graphicCard);
          if(changed)wordsChanged=true;
          return changed||cardChanged?{...scene,words:changed?undefined:scene.words,motion:{...scene.motion,headline:scene.graphicCard?.headline||scene.text,accent:scene.graphicCard?.statValue||emphasisFrom(scene.text)}}:scene;
        });
        if(wordsChanged&&stored.session.directorReport)stored.session.directorReport={...stored.session.directorReport,alignment:{engine:'estimated',coverage:0},notices:['The storyboard text/timing changed. Regenerate direction to recognize speech again.']};
      }
    }
    try {await saveProject(stored);res.json(stored.session);}
    catch(error){res.status(500).json({error:`Could not save project: ${error instanceof Error?error.message:String(error)}`});}
  });

  // 6. Upload or replace background music bed on an existing project
  router.post('/projects/:id/music', upload.single('music'), async (req, res) => {
    const stored = await getProject(req.params.id);
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
        source:'uploaded',
        filename: req.file.originalname,
        url: `/api/media/${stored.session.id}/music/${savedName}`,
        durationMs,
        volumeDb,
        duckingEnabled,
      };

      await saveProject(stored);
    res.json(stored.session);
    } catch (err: unknown) {
      await fs.rm(req.file.path, { force: true }).catch(() => {});
      const message = err instanceof Error ? err.message : 'Failed to process background music.';
      res.status(500).json({ error: message });
    }
  });

  // 7. Start 1080p MP4 export job
  router.post('/projects/:id/export', async (req, res) => {
    const stored = await getProject(req.params.id);
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
    if(scenes.every(scene=>scene.beatKind==='graphic-card'||stored.mediaById.has(scene.imageId)))stored.session.scenes = scenes;

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

    try {
      await saveProject(stored);
      await persistJobMetadata(jobRecord);
    } catch (error) {
      jobs.delete(jobId);
      res.status(500).json({ error: `Cannot save render job: ${error instanceof Error ? error.message : String(error)}` });
      return;
    }
    const controller=new AbortController();renderControllers.set(jobId,controller);
    const snapshot={audioPath:stored.audioPath,audioDurationMs:stored.session.audio.durationMs,musicPath:stored.musicPath,backgroundMusic:structuredClone(stored.session.backgroundMusic),transitionDurationMs:stored.session.transitionDurationMs,scenes:structuredClone(scenes),mediaById:new Map(stored.mediaById)};
    let completedState: RenderJobState | undefined;
    void renderQueue.enqueue(async()=>{
      try {
        const disk=await fs.statfs(stored.projectDir);
        const needed=256*1024*1024+snapshot.audioDurationMs*8000;
        if(disk.bavail*disk.bsize<needed)throw new Error(`Not enough free disk space. Free approximately ${Math.ceil(needed/1024/1024)} MB before rendering this reel.`);
      }catch(error){if(error instanceof Error&&error.message.startsWith('Not enough'))throw error;}
      return renderProjectMp4({
      jobId,
      projectId: stored.session.id,
      projectDir: stored.projectDir,
      sfxDir: SFX_BANK_DIR,
      audioPath: snapshot.audioPath,
      audioDurationMs: snapshot.audioDurationMs,
      musicPath: snapshot.musicPath,
      backgroundMusic: snapshot.backgroundMusic,
      aspectRatio,
      motionIntensity,
      transitionStyle,
      transitionDurationMs: snapshot.transitionDurationMs,
      subtitlesEnabled,
      captionMode,
      textEffect,
      fontStyle,
      accentColor,
      brandKicker,
      sfxConfig,
      encoderId: chosenEncoder,
      signal:controller.signal,
      scenes: snapshot.scenes,
      mediaById: snapshot.mediaById,
      onProgress: (nextState) => {
        if (nextState.status === 'completed') {
          completedState = nextState;
          return;
        }
        jobRecord.state = nextState;
        emitter.emit('progress', nextState);
      },
      });
    },controller.signal)
      .then(async (outputPath) => {
        if(controller.signal.aborted){await fs.rm(outputPath,{force:true});throw new Error('Render cancelled.');}
        if (!completedState) throw new Error('Render did not report a validated output.');
        // Persist first, then expose completion with an immediately usable download.
        await persistJobMetadata({ ...jobRecord, state: completedState, outputPath });
        jobRecord.outputPath = outputPath;
        jobRecord.state = completedState;
        emitter.emit('progress', jobRecord.state);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : 'FFmpeg render failed.';
        jobRecord.state = {
          ...jobRecord.state,
          status: controller.signal.aborted?'cancelled':'failed',
          stage: controller.signal.aborted?'Render cancelled':'Render failed',
          message: msg,
          error: msg,
        };
        void persistJobMetadata(jobRecord).catch(error => console.error('Could not persist failed render job:', error));
        emitter.emit('progress', jobRecord.state);
      }).finally(()=>renderControllers.delete(jobId));

    res.json({ jobId, state: initialState });
  });

  router.post('/jobs/:jobId/cancel',async(req,res)=>{
    const job=await resolveJobRecord(req.params.jobId),controller=renderControllers.get(req.params.jobId);
    if(!job||!controller){res.status(404).json({error:'Active render job not found.'});return;}
    if(['completed','failed','cancelled'].includes(job.state.status)){res.status(409).json({error:'This render has already finished.'});return;}
    controller.abort();
    job.state={...job.state,status:'cancelled',stage:'Render cancelled',message:'Cancelled by user. Temporary render files are being cleaned.',outputUrl:undefined,fileSizeBytes:undefined};
    await persistJobMetadata(job);job.emitter.emit('progress',job.state);res.json(job.state);
  });

  // 7b. Recover most recent completed MP4 export from disk (survives page reload/restart & finds pre-existing renders)
  router.get('/exports/recent', async (_req, res) => {
    try {
      await fs.mkdir(JOBS_META_DIR, { recursive: true });
      const completed: Array<{ mtimeMs: number; state: RenderJobState }> = [];
      const metaFiles = await fs.readdir(JOBS_META_DIR);
      for (const file of metaFiles) {
        if (!file.endsWith('.json')) continue;
        const job = await resolveJobRecord(file.slice(0, -5));
        if (job?.state.status !== 'completed' || !job.outputPath) continue;
        try {
          const stat = await fs.stat(job.outputPath);
          completed.push({ mtimeMs: stat.mtimeMs, state: job.state });
        } catch {
          // Deleted exports are not offered as downloads.
        }
      }
      completed.sort((a, b) => b.mtimeMs - a.mtimeMs);
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
      if (state.status === 'completed' || state.status === 'failed' || state.status === 'cancelled') {
        res.end();
      }
    };

    sendEvent(job.state);

    if (job.state.status !== 'completed' && job.state.status !== 'failed' && job.state.status !== 'cancelled') {
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
    if (!job || job.state.status !== 'completed' || !job.outputPath) {
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
    if (!job || job.state.status !== 'completed' || !job.outputPath) {
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
