export type AspectRatio = '9:16' | '16:9';

export type MotionIntensity = 'subtle' | 'moderate' | 'none';

export type PacingMode = 'rapid-reel' | 'dynamic-explainer' | 'upload-match';

export type KenBurnsDirection =
  | 'zoom-in'
  | 'zoom-out'
  | 'pan-left'
  | 'pan-right'
  | 'snap-zoom-in'
  | 'whip-zoom'
  | 'pan-up'
  | 'impact-shake';

export type FocalCropRegion =
  | 'full'
  | 'left-focus'
  | 'right-focus'
  | 'top-hero'
  | 'tight-macro'
  | 'bottom-detail';

export type BeatKind = 'media' | 'crop-cut' | 'graphic-card';

export type GraphicCardType = 'stat-counter' | 'statement' | 'split-contrast';

export type GraphicCardTheme = 'obsidian' | 'cream-poster' | 'noir-gold';

export interface GraphicCardData {
  cardType: GraphicCardType;
  theme: GraphicCardTheme;
  headline: string;
  statValue?: string;
  statUnit?: string;
  leftLabel?: string;
  rightLabel?: string;
  kicker?: string;
}

export type CaptionZone = 'top-banner' | 'center-impact' | 'lower-hero';

export type MatchingPreference = 'auto' | 'gemini' | 'ollama' | 'local';

export type TransitionStyle = 'whip-dynamic' | 'crossfade' | 'cut';

export type CaptionMode = 'explainer-kinetic' | 'word-pop' | 'bottom-third' | 'off';

export type TextEffectId =
  | 'type-reveal'
  | 'kinetic-karaoke'
  | 'punch-pop'
  | 'slide-up'
  | 'highlight-box';

export type FontStyleId =
  | 'modern-sans'
  | 'mixed-editorial'
  | 'editorial-serif'
  | 'mono-tech';

export type AccentColorId = 'coral' | 'gold' | 'cyan' | 'emerald';

export type SfxCueType =
  | 'none'
  | 'impact'
  | 'whoosh'
  | 'pop'
  | 'riser'
  | 'glitch'
  | 'chime'
  | 'typeclick'
  | 'thud'
  | 'shutter'
  | 'cashtick'
  | 'keyburst'
  | 'flashwhoosh';

export interface SfxConfig {
  enabled: boolean;
  volumeDb: number;
  includeTransitionWhoosh: boolean;
  includeTextPop: boolean;
  includeHookImpact: boolean;
  includeMicroBeatTicks: boolean;
}

export type ArtStylePresetId =
  | 'saveo-ink'
  | 'stick-figure'
  | 'noir-gold'
  | 'whiteboard-sketch'
  | 'documentary-35mm'
  | 'editorial-cream'
  | 'midnight-crimson'
  | 'stylized-3d'
  | 'custom';

export type TtsVoiceName = 'Charon' | 'Fenrir' | 'Kore' | 'Puck' | 'Zephyr';

export interface BlueprintScene {
  index: number;
  title: string;
  spokenLine: string;
  kicker: string;
  accentPhrase: string;
  sfxCue: SfxCueType;
  beatKind?: BeatKind;
  graphicCard?: GraphicCardData;
  visualAction: string;
  imagePrompt: string;
}

export interface StoryBlueprint {
  id: string;
  topic: string;
  language: string;
  artStyleId: ArtStylePresetId;
  artStyleLabel: string;
  categoryLabel: string;
  characterAnchor: string;
  masterStyleAnchor: string;
  continuityPrefix: string;
  fullScript: string;
  scenes: BlueprintScene[];
  engineUsed: 'gemini-4-hydrogen' | 'local-template';
  fallbackNotice?: string;
}

export type MediaType = 'image' | 'video';

export type AlignmentSource = 'voice-locked' | 'pause-snapped' | 'estimated';

export interface SpeechPause {
  startMs: number;
  endMs: number;
  durationMs: number;
  midMs: number;
}

export interface UploadedAudio {
  filename: string;
  url: string;
  durationMs: number;
  sampleRate: number;
  channels: number;
  codec: string;
  waveformPeaks: number[];
  pauses: SpeechPause[];
}

export interface BackgroundMusicTrack {
  filename: string;
  url: string;
  durationMs: number;
  volumeDb: number;
  duckingEnabled: boolean;
}

export interface UploadedImage {
  id: string;
  originalName: string;
  mediaType: MediaType;
  clipDurationMs?: number;
  url: string;
  thumbUrl: string;
  width: number;
  height: number;
  visualSummary: string;
}

export interface SceneItem {
  id: string;
  index: number;
  text: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  imageId: string;
  matchReason: string;
  emotionalWeight: number;
  kenBurnsDirection: KenBurnsDirection;
  snappedToPause: boolean;
  alignmentSource: AlignmentSource;
  beatKind?: BeatKind;
  focalCrop?: FocalCropRegion;
  graphicCard?: GraphicCardData;
  captionZone?: CaptionZone;
  kicker?: string;
  accentPhrase?: string;
  sfxCue?: SfxCueType;
  imagePrompt?: string;
}

export interface EncoderOption {
  id: string;
  label: string;
  isHardware: boolean;
  vendor: string;
}

export interface StudioCapabilities {
  ffmpegVersion: string;
  geminiConfigured: boolean;
  ollamaVisionAvailable?: boolean;
  ollamaVisionModel?: string;
  ollamaVisionHelp?: string;
  availableEncoders: EncoderOption[];
  recommendedEncoder: EncoderOption;
}

export interface ProjectSession {
  id: string;
  createdAt: string;
  aspectRatio: AspectRatio;
  pacingMode?: PacingMode;
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
  matchingEngineUsed: 'gemini-4-hydrogen' | 'gemini-vision' | 'ollama-vision' | 'local-heuristic';
  fallbackNotice?: string;
  audio: UploadedAudio;
  backgroundMusic?: BackgroundMusicTrack;
  rawScript: string;
  images: UploadedImage[];
  scenes: SceneItem[];
}

export interface RenderJobState {
  jobId: string;
  projectId: string;
  status: 'queued' | 'rendering' | 'muxing' | 'completed' | 'failed';
  progress: number;
  currentScene: number;
  totalScenes: number;
  stage: string;
  message: string;
  encoderUsed: string;
  elapsedMs: number;
  outputUrl?: string;
  fileSizeBytes?: number;
  error?: string;
}
