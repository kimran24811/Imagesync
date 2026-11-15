import React, { useMemo, useRef, useState } from 'react';
import {
  FileAudio,
  Film,
  FolderOpen,
  ImagePlus,
  Layers,
  Loader2,
  Music,
  Play,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  X,
} from 'lucide-react';
import type {
  AccentColorId,
  AspectRatio,
  CaptionMode,
  FontStyleId,
  GraphicCardTheme,
  MatchingPreference,
  MotionIntensity,
  PacingMode,
  SfxConfig,
  StudioCapabilities,
  TextEffectId,
  TransitionStyle,
} from '../types/studio';
import { ACCENT_COLOR_HEX } from '../utils/captions';
import { formatBytes } from '../utils/time';
import {
  BlueprintWorkspace,
  type BlueprintTransferPayload,
} from './BlueprintWorkspace';

export interface QueuedImageFile {
  id: string;
  file: File;
  previewUrl: string;
  isVideo: boolean;
}

export type IntakeTab = 'assemble' | 'blueprint';

interface IntakeWorkspaceProps {
  activeTab: IntakeTab;
  onChangeTab: (tab: IntakeTab) => void;
  blueprintNotice: string | null;
  onDismissBlueprintNotice: () => void;
  onSendBlueprintToAssembler: (payload: BlueprintTransferPayload) => void;

  audioFile: File | null;
  onSelectAudio: (file: File | null) => void;
  musicFile: File | null;
  onSelectMusic: (file: File | null) => void;
  musicVolumeDb: number;
  onChangeMusicVolumeDb: (db: number) => void;
  musicDucking: boolean;
  onChangeMusicDucking: (duck: boolean) => void;
  script: string;
  onChangeScript: (val: string) => void;
  imageFiles: QueuedImageFile[];
  onAddImages: (files: FileList | File[]) => void;
  onRemoveImage: (id: string) => void;
  onClearImages: () => void;
  aspectRatio: AspectRatio;
  onChangeAspectRatio: (ratio: AspectRatio) => void;
  pacingMode: PacingMode;
  onChangePacingMode: (mode: PacingMode) => void;
  graphicCardTheme: GraphicCardTheme;
  onChangeGraphicCardTheme: (theme: GraphicCardTheme) => void;
  motionIntensity: MotionIntensity;
  onChangeMotionIntensity: (intensity: MotionIntensity) => void;
  transitionStyle: TransitionStyle;
  onChangeTransitionStyle: (style: TransitionStyle) => void;
  captionMode: CaptionMode;
  onChangeCaptionMode: (mode: CaptionMode) => void;
  textEffect: TextEffectId;
  onChangeTextEffect: (effect: TextEffectId) => void;
  fontStyle: FontStyleId;
  onChangeFontStyle: (font: FontStyleId) => void;
  accentColor: AccentColorId;
  onChangeAccentColor: (color: AccentColorId) => void;
  brandKicker: string;
  onChangeBrandKicker: (kicker: string) => void;
  sfxConfig: SfxConfig;
  onChangeSfxConfig: (patch: Partial<SfxConfig>) => void;
  matchingPreference: MatchingPreference;
  onChangeMatchingPreference: (pref: MatchingPreference) => void;
  selectedEncoderId: string;
  onChangeEncoderId: (id: string) => void;
  capabilities: StudioCapabilities | null;
  isAnalyzing: boolean;
  analyzePhase: string;
  errorMessage: string | null;
  onRunAnalysis: () => void;
  onRunSample: () => void;
}

export const IntakeWorkspace: React.FC<IntakeWorkspaceProps> = ({
  activeTab,
  onChangeTab,
  blueprintNotice,
  onDismissBlueprintNotice,
  onSendBlueprintToAssembler,
  audioFile,
  onSelectAudio,
  musicFile,
  onSelectMusic,
  musicVolumeDb,
  onChangeMusicVolumeDb,
  musicDucking,
  onChangeMusicDucking,
  script,
  onChangeScript,
  imageFiles,
  onAddImages,
  onRemoveImage,
  onClearImages,
  aspectRatio,
  onChangeAspectRatio,
  pacingMode,
  onChangePacingMode,
  graphicCardTheme,
  onChangeGraphicCardTheme,
  motionIntensity,
  onChangeMotionIntensity,
  transitionStyle,
  onChangeTransitionStyle,
  captionMode,
  onChangeCaptionMode,
  textEffect,
  onChangeTextEffect,
  fontStyle,
  onChangeFontStyle,
  accentColor,
  onChangeAccentColor,
  brandKicker,
  onChangeBrandKicker,
  sfxConfig,
  onChangeSfxConfig,
  matchingPreference,
  onChangeMatchingPreference,
  selectedEncoderId,
  onChangeEncoderId,
  capabilities,
  isAnalyzing,
  analyzePhase,
  errorMessage,
  onRunAnalysis,
  onRunSample,
}) => {
  const audioInputRef = useRef<HTMLInputElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const [audioDragOver, setAudioDragOver] = useState(false);
  const [imageDragOver, setImageDragOver] = useState(false);

  const wordCount = useMemo(() => {
    const trimmed = script.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
  }, [script]);

  const videoCount = useMemo(
    () => imageFiles.filter((f) => f.isVideo).length,
    [imageFiles]
  );

  const canGenerate = Boolean(
    audioFile && script.trim().length > 0 && imageFiles.length > 0 && !isAnalyzing
  );

  const handleAudioDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setAudioDragOver(false);
    const dropped = e.dataTransfer.files?.[0];
    if (dropped && /\.(mp3|wav|m4a|ogg|aac)$/i.test(dropped.name)) {
      onSelectAudio(dropped);
    }
  };

  const handleImageDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setImageDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onAddImages(e.dataTransfer.files);
    }
  };

  return (
    <section className="mx-auto max-w-[1440px] px-6 py-8">
      {/* Editorial Section Header + 2-Tab Mode Switcher */}
      <div className="mb-8 flex flex-col gap-5 border-b border-[#E2E8F0] pb-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-bold tracking-tight text-[#0F172A] sm:text-3xl text-balance">
            {activeTab === 'blueprint'
              ? 'Style-Locked Story Blueprint & Prompts'
              : 'Automated Audio-to-Visual Assembly'}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[#475569]">
            {activeTab === 'blueprint'
              ? 'Generate a character-consistent prompt pack ("one character, every shot"), voiceover script, and optional free Gemini narration—then feed your generated pictures into the Assembler.'
              : 'Drop your voiceover, optional music bed, script, and photos or B-roll clips. SceneSync locks cuts to your voice, adds multi-size kinetic explainer text, synchronized SFX, and masters 1080p MP4.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          <div className="inline-flex rounded-lg bg-[#F1F5F9] p-1">
            <button
              type="button"
              onClick={() => onChangeTab('assemble')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === 'assemble'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              <Layers className="h-3.5 w-3.5 text-[#2563EB]" aria-hidden="true" />
              <span>Assemble Video</span>
            </button>
            <button
              type="button"
              onClick={() => onChangeTab('blueprint')}
              className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                activeTab === 'blueprint'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              <Sparkles className="h-3.5 w-3.5 text-[#2563EB]" aria-hidden="true" />
              <span>Story Blueprint (Free)</span>
            </button>
          </div>

          {activeTab === 'assemble' && (
            <button
              type="button"
              disabled={isAnalyzing}
              onClick={onRunSample}
              className="inline-flex items-center gap-2 rounded-lg border border-[#CBD5E1] bg-white px-4 py-2 text-sm font-medium text-[#0F172A] transition-colors hover:bg-[#F1F5F9] disabled:opacity-50 whitespace-nowrap shrink-0"
            >
              <Play className="h-3.5 w-3.5 text-[#2563EB]" aria-hidden="true" />
              <span>Load Sample Story</span>
            </button>
          )}
        </div>
      </div>

      {activeTab === 'blueprint' ? (
        <BlueprintWorkspace
          aspectRatio={aspectRatio}
          onChangeAspectRatio={onChangeAspectRatio}
          geminiConfigured={Boolean(capabilities?.geminiConfigured)}
          onSendToAssembler={onSendBlueprintToAssembler}
        />
      ) : (
        <>
          {blueprintNotice && (
            <div className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-[#DBEAFE] bg-[#EFF6FF] px-4 py-3 text-xs text-[#1E3A8A]">
              <span>{blueprintNotice}</span>
              <button
                type="button"
                onClick={onDismissBlueprintNotice}
                aria-label="Dismiss notice"
                className="text-[#1E40AF] hover:text-[#0F172A]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}

          {errorMessage && (
            <div
              role="alert"
              className="mb-6 flex items-start justify-between gap-4 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]"
            >
              <span>{errorMessage}</span>
            </div>
          )}

          {/* 3-Input Studio Intake Grid */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            {/* Column 1: Voiceover & Background Music (4 cols) */}
            <div className="flex flex-col rounded-xl border border-[#E2E8F0] bg-white p-5 lg:col-span-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-[#0F172A]">
                  01. Voiceover & Music
                </h2>
                <span className="text-xs text-[#64748B]">MP3 or WAV</span>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setAudioDragOver(true);
                }}
                onDragLeave={() => setAudioDragOver(false)}
                onDrop={handleAudioDrop}
                onClick={() => audioInputRef.current?.click()}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') audioInputRef.current?.click();
                }}
                className={`flex flex-1 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-5 text-center transition-colors min-h-[155px] ${
                  audioDragOver
                    ? 'border-[#2563EB] bg-[#EFF6FF]'
                    : 'border-[#CBD5E1] bg-[#F8FAFC] hover:border-[#94A3B8]'
                }`}
              >
                <input
                  ref={audioInputRef}
                  type="file"
                  accept=".mp3,.wav,.m4a,.ogg,.aac,audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f) onSelectAudio(f);
                  }}
                />

                {audioFile ? (
                  <div className="flex w-full flex-col items-center gap-1.5">
                    <FileAudio className="h-7 w-7 text-[#2563EB]" aria-hidden="true" />
                    <p className="max-w-full truncate text-sm font-semibold text-[#0F172A]">
                      {audioFile.name}
                    </p>
                    <p className="text-xs text-[#475569] tabular-time">
                      {formatBytes(audioFile.size)} · Voice-lock ready
                    </p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectAudio(null);
                      }}
                      className="mt-1 inline-flex items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-2.5 py-1 text-xs font-medium text-[#475569] hover:text-[#DC2626]"
                    >
                      <X className="h-3 w-3" aria-hidden="true" />
                      <span>Remove voiceover</span>
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1.5">
                    <Upload className="h-6 w-6 text-[#64748B]" aria-hidden="true" />
                    <p className="text-sm font-medium text-[#0F172A]">
                      Drop voiceover file or browse
                    </p>
                    <p className="text-xs text-[#64748B]">
                      Detects exact spoken word timestamps & pauses
                    </p>
                  </div>
                )}
              </div>

              {/* Optional Background Music Bed */}
              <div className="mt-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                <input
                  ref={musicInputRef}
                  type="file"
                  accept=".mp3,.wav,.m4a,.ogg,.aac,audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    if (f) onSelectMusic(f);
                    e.target.value = '';
                  }}
                />

                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Music className="h-4 w-4 shrink-0 text-[#475569]" aria-hidden="true" />
                    <span className="truncate text-xs font-medium text-[#0F172A]">
                      {musicFile ? musicFile.name : 'Background Music Bed (Optional)'}
                    </span>
                  </div>
                  {musicFile ? (
                    <button
                      type="button"
                      onClick={() => onSelectMusic(null)}
                      className="text-xs font-medium text-[#DC2626] hover:underline whitespace-nowrap shrink-0"
                    >
                      Remove
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => musicInputRef.current?.click()}
                      className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 text-xs font-medium text-[#0F172A] hover:bg-[#F1F5F9] whitespace-nowrap shrink-0"
                    >
                      Add Music
                    </button>
                  )}
                </div>

                {musicFile && (
                  <div className="mt-2.5 flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] pt-2 text-xs text-[#475569]">
                    <label className="flex items-center gap-2">
                      <span className="tabular-time">Level ({musicVolumeDb} dB)</span>
                      <input
                        type="range"
                        min={-26}
                        max={-6}
                        step={1}
                        value={musicVolumeDb}
                        onChange={(e) => onChangeMusicVolumeDb(Number(e.target.value))}
                        className="h-1.5 w-20 accent-[#2563EB]"
                      />
                    </label>
                    <label className="inline-flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={musicDucking}
                        onChange={(e) => onChangeMusicDucking(e.target.checked)}
                        className="rounded border-[#CBD5E1] accent-[#2563EB]"
                      />
                      <span>Auto-duck under speech</span>
                    </label>
                  </div>
                )}
              </div>
            </div>

            {/* Column 2: Unformatted Script (4 cols) */}
            <div className="flex flex-col rounded-xl border border-[#E2E8F0] bg-white p-5 lg:col-span-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-[#0F172A]">
                  02. Voiceover Script
                </h2>
                <span className="text-xs text-[#64748B] tabular-time">
                  {wordCount} words · {script.length} chars
                </span>
              </div>

              <textarea
                value={script}
                onChange={(e) => onChangeScript(e.target.value)}
                placeholder="Paste your voiceover script here (English, Roman Urdu, Urdu, Hindi, or any language). Tip: wrap *accent words* in asterisks to highlight them in color..."
                rows={8}
                className="w-full flex-1 resize-none rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] p-3.5 text-sm leading-relaxed text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:bg-white focus:outline-none min-h-[225px]"
              />
            </div>

            {/* Column 3: Unsorted Photos & B-Roll Clips (4 cols) */}
            <div className="flex flex-col rounded-xl border border-[#E2E8F0] bg-white p-5 lg:col-span-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h2 className="text-base font-semibold text-[#0F172A]">
                  03. Photos & B-Roll Clips
                </h2>
                <div className="flex items-center gap-3 text-xs text-[#64748B]">
                  <span className="tabular-time">
                    {imageFiles.length} items{videoCount > 0 ? ` (${videoCount} video)` : ''}
                  </span>
                  {imageFiles.length > 0 && (
                    <button
                      type="button"
                      onClick={onClearImages}
                      className="inline-flex items-center gap-1 text-[#DC2626] hover:underline"
                    >
                      <Trash2 className="h-3 w-3" aria-hidden="true" />
                      <span>Clear</span>
                    </button>
                  )}
                </div>
              </div>

              <input
                ref={imageInputRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    onAddImages(e.target.files);
                    e.target.value = '';
                  }
                }}
              />
              <input
                ref={folderInputRef}
                type="file"
                accept="image/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                multiple
                {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    onAddImages(e.target.files);
                    e.target.value = '';
                  }
                }}
              />

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setImageDragOver(true);
                }}
                onDragLeave={() => setImageDragOver(false)}
                onDrop={handleImageDrop}
                className={`flex flex-1 flex-col justify-between rounded-lg border border-dashed p-4 transition-colors min-h-[225px] ${
                  imageDragOver
                    ? 'border-[#2563EB] bg-[#EFF6FF]'
                    : 'border-[#CBD5E1] bg-[#F8FAFC]'
                }`}
              >
                {imageFiles.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center text-center py-4">
                    <ImagePlus className="h-7 w-7 text-[#64748B]" aria-hidden="true" />
                    <p className="mt-2 text-sm font-medium text-[#0F172A]">
                      Drop generated pictures or MP4 clips
                    </p>
                    <p className="mt-1 text-xs text-[#64748B]">
                      Random order supported — AI matches visuals to spoken lines
                    </p>
                  </div>
                ) : (
                  <div className="grid max-h-[155px] grid-cols-4 gap-2 overflow-y-auto pr-1">
                    {imageFiles.map((item) => (
                      <div
                        key={item.id}
                        className="group relative aspect-square overflow-hidden rounded-md border border-[#E2E8F0] bg-[#0F172A]"
                      >
                        {item.isVideo ? (
                          <video
                            src={item.previewUrl}
                            muted
                            playsInline
                            preload="metadata"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <img
                            src={item.previewUrl}
                            alt={item.file.name}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        )}
                        {item.isVideo && (
                          <div className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-0.5 rounded bg-black/75 px-1 py-0.5 text-[9px] font-semibold text-white">
                            <Film className="h-2.5 w-2.5" aria-hidden="true" />
                            <span>MP4</span>
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemoveImage(item.id)}
                          aria-label={`Remove ${item.file.name}`}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-opacity group-hover:opacity-100"
                        >
                          <X className="h-3 w-3" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-3 flex items-center gap-2 pt-2 border-t border-[#E2E8F0]">
                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] hover:bg-[#F1F5F9] whitespace-nowrap"
                  >
                    <FolderOpen className="h-3.5 w-3.5 text-[#2563EB]" aria-hidden="true" />
                    <span>Select Folder</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] hover:bg-[#F1F5F9] whitespace-nowrap"
                  >
                    <ImagePlus className="h-3.5 w-3.5 text-[#475569]" aria-hidden="true" />
                    <span>Add Media</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Studio Parameters: Kinetic Typography, Accent Color, SFX & Execution Strip */}
          <div className="mt-6 space-y-4 rounded-xl border border-[#E2E8F0] bg-white p-5">
            <div className="flex flex-wrap items-center gap-5">
              {/* Aspect Ratio */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-[#475569]">Output Format</span>
                <div className="inline-flex rounded-lg bg-[#F1F5F9] p-1">
                  <button
                    type="button"
                    onClick={() => onChangeAspectRatio('9:16')}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      aspectRatio === '9:16'
                        ? 'bg-white text-[#0F172A] shadow-xs'
                        : 'text-[#475569] hover:text-[#0F172A]'
                    }`}
                  >
                    9:16 Shorts
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeAspectRatio('16:9')}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      aspectRatio === '16:9'
                        ? 'bg-white text-[#0F172A] shadow-xs'
                        : 'text-[#475569] hover:text-[#0F172A]'
                    }`}
                  >
                    16:9 YouTube
                  </button>
                </div>
              </div>

              {/* Cut Pacing Mode (Auto Concept Multiplier) */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-[#475569]">Cut Pacing</span>
                <div className="inline-flex rounded-lg bg-[#F1F5F9] p-1">
                  {(
                    [
                      ['rapid-reel', 'Rapid Reel (1–1.5s)'],
                      ['dynamic-explainer', 'Dynamic (1.8–2.5s)'],
                      ['upload-match', '1-to-1 Uploads'],
                    ] as Array<[PacingMode, string]>
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onChangePacingMode(mode)}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        pacingMode === mode
                          ? 'bg-white text-[#0F172A] shadow-xs'
                          : 'text-[#475569] hover:text-[#0F172A]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Auto Graphic Card Theme */}
              <div className="flex flex-col gap-1.5">
                <label
                  htmlFor="card-theme-select"
                  className="text-xs font-medium text-[#475569]"
                >
                  Auto Card Style
                </label>
                <select
                  id="card-theme-select"
                  value={graphicCardTheme}
                  onChange={(e) => onChangeGraphicCardTheme(e.target.value as GraphicCardTheme)}
                  className="rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                >
                  <option value="obsidian">Obsidian Dark</option>
                  <option value="cream-poster">Cream Poster</option>
                  <option value="noir-gold">Noir Gold</option>
                </select>
              </div>

              {/* Caption & Kinetic Typography Style */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-[#475569]">
                  Typography & Captions
                </span>
                <div className="inline-flex flex-wrap rounded-lg bg-[#F1F5F9] p-1">
                  {(
                    [
                      ['explainer-kinetic', 'Explainer Kinetic'],
                      ['word-pop', 'Word-Pop'],
                      ['bottom-third', 'Bottom-Third'],
                      ['off', 'Off'],
                    ] as Array<[CaptionMode, string]>
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onChangeCaptionMode(mode)}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        captionMode === mode
                          ? 'bg-white text-[#0F172A] shadow-xs'
                          : 'text-[#475569] hover:text-[#0F172A]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Effect, Font Style, Accent Color & Brand Kicker */}
              {captionMode !== 'off' && (
                <>
                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="text-effect-select"
                      className="text-xs font-medium text-[#475569]"
                    >
                      Dynamic Text Effect
                    </label>
                    <select
                      id="text-effect-select"
                      value={textEffect}
                      onChange={(e) => onChangeTextEffect(e.target.value as TextEffectId)}
                      className="rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                    >
                      <option value="type-reveal">Word-by-Word Reveal</option>
                      <option value="kinetic-karaoke">Dynamic Karaoke</option>
                      <option value="punch-pop">Punch Pop</option>
                      <option value="slide-up">Smooth Slide-Up</option>
                      <option value="highlight-box">Highlight Box</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="font-style-select"
                      className="text-xs font-medium text-[#475569]"
                    >
                      Font Pairing
                    </label>
                    <select
                      id="font-style-select"
                      value={fontStyle}
                      onChange={(e) => onChangeFontStyle(e.target.value as FontStyleId)}
                      className="rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                    >
                      <option value="modern-sans">Modern Sans</option>
                      <option value="mixed-editorial">Mixed Sans + Serif</option>
                      <option value="editorial-serif">Editorial Serif</option>
                      <option value="mono-tech">Mono Terminal</option>
                    </select>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-medium text-[#475569]">Accent Color</span>
                    <div className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1.5">
                      {(Object.keys(ACCENT_COLOR_HEX) as AccentColorId[]).map((colorKey) => {
                        const meta = ACCENT_COLOR_HEX[colorKey];
                        const active = accentColor === colorKey;
                        return (
                          <button
                            key={colorKey}
                            type="button"
                            onClick={() => onChangeAccentColor(colorKey)}
                            title={meta.label}
                            aria-label={meta.label}
                            style={{ backgroundColor: meta.hex }}
                            className={`h-5 w-5 rounded-full transition-transform ${
                              active
                                ? 'scale-110 ring-2 ring-[#0F172A] ring-offset-1'
                                : 'opacity-70 hover:opacity-100'
                            }`}
                          />
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label
                      htmlFor="brand-kicker"
                      className="text-xs font-medium text-[#475569]"
                    >
                      Top Kicker Handle
                    </label>
                    <input
                      id="brand-kicker"
                      type="text"
                      value={brandKicker}
                      onChange={(e) => onChangeBrandKicker(e.target.value)}
                      placeholder="@yourhandle"
                      className="w-32 rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                </>
              )}

              {/* Motion Intensity */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-[#475569]">Ken Burns</span>
                <div className="inline-flex rounded-lg bg-[#F1F5F9] p-1">
                  {(['subtle', 'moderate', 'none'] as MotionIntensity[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onChangeMotionIntensity(mode)}
                      className={`rounded-md px-2.5 py-1.5 text-xs font-medium capitalize transition-colors whitespace-nowrap ${
                        motionIntensity === mode
                          ? 'bg-white text-[#0F172A] shadow-xs'
                          : 'text-[#475569] hover:text-[#0F172A]'
                      }`}
                    >
                      {mode === 'none' ? 'Static' : mode}
                    </button>
                  ))}
                </div>
              </div>

              {/* Transitions */}
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-[#475569]">Transitions</span>
                <div className="inline-flex rounded-lg bg-[#F1F5F9] p-1">
                  <button
                    type="button"
                    onClick={() => onChangeTransitionStyle('whip-dynamic')}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      transitionStyle === 'whip-dynamic'
                        ? 'bg-white text-[#0F172A] shadow-xs'
                        : 'text-[#475569] hover:text-[#0F172A]'
                    }`}
                  >
                    Whip Dynamic 0.14s
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeTransitionStyle('crossfade')}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      transitionStyle === 'crossfade'
                        ? 'bg-white text-[#0F172A] shadow-xs'
                        : 'text-[#475569] hover:text-[#0F172A]'
                    }`}
                  >
                    Crossfade 0.3s
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeTransitionStyle('cut')}
                    className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      transitionStyle === 'cut'
                        ? 'bg-white text-[#0F172A] shadow-xs'
                        : 'text-[#475569] hover:text-[#0F172A]'
                    }`}
                  >
                    Hard Cut
                  </button>
                </div>
              </div>
            </div>

            {/* Bottom Row: Auto SFX + Engine + Analyze CTA */}
            <div className="flex flex-col gap-4 border-t border-[#E2E8F0] pt-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs">
                  <label className="inline-flex items-center gap-1.5 font-semibold text-[#0F172A] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sfxConfig.enabled}
                      onChange={(e) => onChangeSfxConfig({ enabled: e.target.checked })}
                      className="rounded border-[#CBD5E1] accent-[#2563EB]"
                    />
                    <Volume2 className="h-3.5 w-3.5 text-[#2563EB]" aria-hidden="true" />
                    <span>Auto Sound Effects</span>
                  </label>

                  {sfxConfig.enabled && (
                    <>
                      <span className="text-[#CBD5E1]" aria-hidden="true">|</span>
                      <label className="inline-flex items-center gap-1 text-[#475569] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sfxConfig.includeHookImpact}
                          onChange={(e) =>
                            onChangeSfxConfig({ includeHookImpact: e.target.checked })
                          }
                          className="rounded border-[#CBD5E1] accent-[#2563EB]"
                        />
                        <span>Hook Impact</span>
                      </label>
                      <label className="inline-flex items-center gap-1 text-[#475569] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sfxConfig.includeTransitionWhoosh}
                          onChange={(e) =>
                            onChangeSfxConfig({ includeTransitionWhoosh: e.target.checked })
                          }
                          className="rounded border-[#CBD5E1] accent-[#2563EB]"
                        />
                        <span>Whoosh Cuts</span>
                      </label>
                      <label className="inline-flex items-center gap-1 text-[#475569] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sfxConfig.includeTextPop}
                          onChange={(e) =>
                            onChangeSfxConfig({ includeTextPop: e.target.checked })
                          }
                          className="rounded border-[#CBD5E1] accent-[#2563EB]"
                        />
                        <span>Text Pops</span>
                      </label>
                      <label className="inline-flex items-center gap-1 text-[#475569] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={sfxConfig.includeMicroBeatTicks}
                          onChange={(e) =>
                            onChangeSfxConfig({ includeMicroBeatTicks: e.target.checked })
                          }
                          className="rounded border-[#CBD5E1] accent-[#2563EB]"
                        />
                        <span>Mid-Scene Micro Beats</span>
                      </label>
                      <label className="inline-flex items-center gap-1.5 text-[#475569] tabular-time">
                        <span>Mix ({sfxConfig.volumeDb} dB)</span>
                        <input
                          type="range"
                          min={-18}
                          max={0}
                          step={1}
                          value={sfxConfig.volumeDb}
                          onChange={(e) =>
                            onChangeSfxConfig({ volumeDb: Number(e.target.value) })
                          }
                          className="h-1.5 w-16 accent-[#2563EB]"
                        />
                      </label>
                    </>
                  )}
                </div>

                {/* Vision Matching Engine */}
                <div className="flex items-center gap-2">
                  <label htmlFor="matching-engine" className="text-xs font-medium text-[#475569]">
                    Sync:
                  </label>
                  <select
                    id="matching-engine"
                    value={matchingPreference}
                    onChange={(e) =>
                      onChangeMatchingPreference(e.target.value as MatchingPreference)
                    }
                    className="rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                  >
                    <option value="auto">
                      Gemini Audio+Vision {capabilities?.geminiConfigured ? '(Ready)' : '(Local fallback)'}
                    </option>
                    <option value="gemini">Gemini Audio + Vision Only</option>
                    <option value="local">Offline Local Matching</option>
                  </select>
                </div>

                {/* Encoder Selection */}
                {capabilities && capabilities.availableEncoders.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label htmlFor="encoder-select" className="text-xs font-medium text-[#475569]">
                      Encoder:
                    </label>
                    <select
                      id="encoder-select"
                      value={selectedEncoderId}
                      onChange={(e) => onChangeEncoderId(e.target.value)}
                      className="rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                    >
                      {capabilities.availableEncoders.map((enc) => (
                        <option key={enc.id} value={enc.id}>
                          {enc.label}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  disabled={!canGenerate}
                  onClick={onRunAnalysis}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#0F172A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1E293B] disabled:cursor-not-allowed disabled:bg-[#94A3B8] whitespace-nowrap"
                >
                  {isAnalyzing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      <span>{analyzePhase || 'Analyzing...'}</span>
                    </>
                  ) : (
                    <span>Analyze & Build Timeline</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
};
