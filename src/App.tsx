import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BlueprintTransferPayload } from './components/BlueprintWorkspace';
import { ExportModal } from './components/ExportModal';
import {
  IntakeWorkspace,
  type IntakeTab,
  type QueuedImageFile,
} from './components/IntakeWorkspace';
import { PhotoSwapDrawer } from './components/PhotoSwapDrawer';
import { StoryboardTimeline } from './components/StoryboardTimeline';
import { SyncPreviewPlayer } from './components/SyncPreviewPlayer';
import { TopBar, type WorkspaceSection } from './components/TopBar';
import type {
  AccentColorId,
  AspectRatio,
  BackgroundMusicTrack,
  BeatKind,
  CaptionMode,
  FontStyleId,
  GraphicCardData,
  GraphicCardTheme,
  MatchingPreference,
  MotionIntensity,
  PacingMode,
  ProjectSession,
  RenderJobState,
  SceneItem,
  SfxConfig,
  StudioCapabilities,
  TextEffectId,
  TransitionStyle,
} from './types/studio';
import { DEFAULT_SFX_CONFIG } from './utils/sfxSchedule';

interface SceneHint {
  kicker?: string;
  accentPhrase?: string;
  sfxCue?: string;
  imagePrompt?: string;
  beatKind?: BeatKind;
  graphicCard?: GraphicCardData;
}

export default function App() {
  const [capabilities, setCapabilities] = useState<StudioCapabilities | null>(null);

  // Intake & Blueprint state
  const [intakeTab, setIntakeTab] = useState<IntakeTab>('assemble');
  const [blueprintNotice, setBlueprintNotice] = useState<string | null>(null);
  const [sceneHints, setSceneHints] = useState<SceneHint[]>([]);

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [musicFile, setMusicFile] = useState<File | null>(null);
  const [musicVolumeDb, setMusicVolumeDb] = useState<number>(-14);
  const [musicDucking, setMusicDucking] = useState<boolean>(true);
  const [script, setScript] = useState('');
  const [imageFiles, setImageFiles] = useState<QueuedImageFile[]>([]);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [pacingMode, setPacingMode] = useState<PacingMode>('rapid-reel');
  const [graphicCardTheme, setGraphicCardTheme] = useState<GraphicCardTheme>('obsidian');
  const [motionIntensity, setMotionIntensity] = useState<MotionIntensity>('subtle');
  const [transitionStyle, setTransitionStyle] = useState<TransitionStyle>('whip-dynamic');
  const [captionMode, setCaptionMode] = useState<CaptionMode>('explainer-kinetic');
  const [textEffect, setTextEffect] = useState<TextEffectId>('type-reveal');
  const [fontStyle, setFontStyle] = useState<FontStyleId>('mixed-editorial');
  const [accentColor, setAccentColor] = useState<AccentColorId>('coral');
  const [brandKicker, setBrandKicker] = useState<string>('');
  const [sfxConfig, setSfxConfig] = useState<SfxConfig>(DEFAULT_SFX_CONFIG);
  const [matchingPreference, setMatchingPreference] = useState<MatchingPreference>('auto');
  const [selectedEncoderId, setSelectedEncoderId] = useState<string>('libx264');

  // Analysis & project session state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzePhase, setAnalyzePhase] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [session, setSession] = useState<ProjectSession | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Live preview & timeline state
  const [activeSection, setActiveSection] = useState<WorkspaceSection>('intake');
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [swapTargetScene, setSwapTargetScene] = useState<SceneItem | null>(null);

  // Export job state
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [renderJob, setRenderJob] = useState<RenderJobState | null>(null);
  const [recentExport, setRecentExport] = useState<RenderJobState | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const intakeRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/capabilities')
      .then((res) => res.json())
      .then((data: StudioCapabilities) => {
        if (!active) return;
        setCapabilities(data);
        if (data.recommendedEncoder?.id) {
          setSelectedEncoderId(data.recommendedEncoder.id);
        }
      })
      .catch(() => {});

    fetch('/api/exports/recent', { credentials: 'include' })
      .then((res) => res.json())
      .then((data: { latest?: RenderJobState | null }) => {
        if (!active) return;
        if (data.latest && data.latest.status === 'completed') {
          setRecentExport(data.latest);
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  const handleAddImages = useCallback((files: FileList | File[]) => {
    const incoming = Array.from(files).filter((f) => {
      const isImg =
        /\.(jpe?g|png|webp|bmp|gif|avif)$/i.test(f.name) || f.type.startsWith('image/');
      const isVid =
        /\.(mp4|mov|webm|mkv|m4v)$/i.test(f.name) || f.type.startsWith('video/');
      return isImg || isVid;
    });
    if (incoming.length === 0) return;

    const mapped: QueuedImageFile[] = incoming.map((file, idx) => {
      const isVideo =
        /\.(mp4|mov|webm|mkv|m4v)$/i.test(file.name) || file.type.startsWith('video/');
      return {
        id: `${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        isVideo,
      };
    });

    setImageFiles((prev) => [...prev, ...mapped]);
  }, []);

  const handleRemoveImage = useCallback((id: string) => {
    setImageFiles((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((item) => item.id !== id);
    });
  }, []);

  const handleClearImages = useCallback(() => {
    setImageFiles((prev) => {
      for (const item of prev) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
  }, []);

  const scrollToSection = useCallback((section: WorkspaceSection) => {
    setActiveSection(section);
    const map = {
      intake: intakeRef.current,
      preview: previewRef.current,
      timeline: timelineRef.current,
    };
    map[section]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  const handleSendBlueprintToAssembler = useCallback(
    async ({ blueprint, generatedAudioUrl, generatedAudioFilename }: BlueprintTransferPayload) => {
      setScript(blueprint.fullScript);
      setSceneHints(
        blueprint.scenes.map((s) => ({
          kicker: s.kicker,
          accentPhrase: s.accentPhrase,
          sfxCue: s.sfxCue,
          imagePrompt: s.imagePrompt,
          beatKind: s.beatKind,
          graphicCard: s.graphicCard,
        }))
      );
      if (blueprint.artStyleId === 'noir-gold') {
        setAccentColor('gold');
        setGraphicCardTheme('noir-gold');
        setCaptionMode('word-pop');
        setTextEffect('punch-pop');
        setFontStyle('editorial-serif');
      } else if (blueprint.artStyleId === 'stick-figure' || blueprint.artStyleId === 'whiteboard-sketch') {
        setAccentColor('cyan');
        setGraphicCardTheme('obsidian');
        setCaptionMode('explainer-kinetic');
        setTextEffect('type-reveal');
        setFontStyle('mixed-editorial');
      } else if (blueprint.artStyleId === 'editorial-cream') {
        setAccentColor('coral');
        setGraphicCardTheme('cream-poster');
        setCaptionMode('explainer-kinetic');
        setTextEffect('highlight-box');
        setFontStyle('mixed-editorial');
      } else {
        setAccentColor('coral');
        setGraphicCardTheme('obsidian');
        setCaptionMode('explainer-kinetic');
        setTextEffect('type-reveal');
        setFontStyle('mixed-editorial');
      }

      if (generatedAudioUrl) {
        try {
          const res = await fetch(generatedAudioUrl);
          if (res.ok) {
            const blob = await res.blob();
            const file = new File([blob], generatedAudioFilename || 'narrator.wav', {
              type: 'audio/wav',
            });
            setAudioFile(file);
          }
        } catch {
          // Leave existing audio untouched if fetch fails
        }
      }

      setBlueprintNotice(
        `Loaded script${generatedAudioUrl ? ', generated Gemini voiceover,' : ''} and ${blueprint.scenes.length} kinetic typography/SFX cues from your "${blueprint.artStyleLabel}" blueprint. Drop your generated pictures below to build the timeline.`
      );
      setIntakeTab('assemble');
    },
    []
  );

  const handleRunAnalysis = async () => {
    if (!audioFile || !script.trim() || imageFiles.length === 0) {
      setErrorMessage('Please provide an audio file, script text, and at least one photo or video clip.');
      return;
    }

    // Avoid uploading 110 photos before discovering there is no actual
    // image-understanding model. No automatic sync can work from filenames alone.
    if (matchingPreference !== 'local' && capabilities) {
      if (matchingPreference === 'gemini' && !capabilities.geminiConfigured) {
        setErrorMessage('Gemini Vision is not configured. Add GEMINI_API_KEY, or install Ollama and select Auto Vision.');
        return;
      }
      if (matchingPreference === 'ollama' && !capabilities.ollamaVisionAvailable) {
        setErrorMessage(capabilities.ollamaVisionHelp || 'Ollama image model is not ready. Run: ollama pull gemma3:4b');
        return;
      }
      if (matchingPreference === 'auto' && !capabilities.geminiConfigured && !capabilities.ollamaVisionAvailable) {
        setErrorMessage('Auto Vision needs a visual AI engine. Install Ollama from https://ollama.com, run: ollama pull gemma3:4b, and reload SceneSync. Or configure GEMINI_API_KEY. You do NOT need to rename pictures.');
        return;
      }
    }

    setErrorMessage(null);
    setIsAnalyzing(true);
    setAnalyzePhase('Initializing upload...');

    const CHUNK_BYTES = 6 * 1024 * 1024; // Keeps every HTTP request well under Cloud Run 32MB limit

    const uploadChunkWithRetry = async (
      uploadId: string,
      fd: FormData
    ): Promise<void> => {
      let lastErr: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await fetch(`/api/uploads/${uploadId}/chunk`, {
            method: 'POST',
            body: fd,
          });
          if (!res.ok) {
            const payload = (await res.json().catch(() => ({}))) as { error?: string };
            throw new Error(payload.error || `Upload failed (${res.status})`);
          }
          return;
        } catch (err) {
          lastErr = err;
          if (attempt === 0) {
            await new Promise((r) => setTimeout(r, 450));
          }
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error('File chunk upload failed.');
    };

    const uploadFileChunked = async (
      uploadId: string,
      file: File,
      role: 'audio' | 'music' | 'media',
      fileKey: string,
      orderIndex: number
    ): Promise<void> => {
      const totalChunks = Math.max(1, Math.ceil(file.size / CHUNK_BYTES));
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        const start = chunkIndex * CHUNK_BYTES;
        const end = Math.min(file.size, start + CHUNK_BYTES);
        const blob = file.slice(start, end);
        const fd = new FormData();
        fd.append('role', role);
        fd.append('fileKey', fileKey);
        fd.append('filename', file.name);
        fd.append('chunkIndex', String(chunkIndex));
        fd.append('totalChunks', String(totalChunks));
        fd.append('orderIndex', String(orderIndex));
        fd.append('chunk', blob, file.name);
        await uploadChunkWithRetry(uploadId, fd);
      }
    };

    try {
      // 1. Initialize staged upload session
      const initRes = await fetch('/api/uploads/init', { method: 'POST' });
      const initData = (await initRes.json()) as { uploadId?: string; error?: string };
      if (!initRes.ok || !initData.uploadId) {
        throw new Error(initData.error || 'Could not initialize upload session.');
      }
      const uploadId = initData.uploadId;

      // 2. Upload voiceover, optional music, and all images/videos safely in <= 6MB chunks
      const totalFiles = 1 + (musicFile ? 1 : 0) + imageFiles.length;
      let doneCount = 0;

      setAnalyzePhase(`Uploading voiceover (1/${totalFiles})...`);
      await uploadFileChunked(uploadId, audioFile, 'audio', 'voiceover', 0);
      doneCount++;

      if (musicFile) {
        setAnalyzePhase(`Uploading music (${doneCount + 1}/${totalFiles})...`);
        await uploadFileChunked(uploadId, musicFile, 'music', 'music_bed', 0);
        doneCount++;
      }

      for (let i = 0; i < imageFiles.length; i++) {
        const item = imageFiles[i];
        setAnalyzePhase(`Uploading media (${doneCount + 1}/${totalFiles})...`);
        await uploadFileChunked(uploadId, item.file, 'media', `m_${i}`, i);
        doneCount++;
      }

      // 3. Kick off asynchronous audio/vision alignment job
      setAnalyzePhase('Analyzing audio & visuals...');
      const startRes = await fetch(`/api/uploads/${uploadId}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script,
          aspectRatio,
          pacingMode,
          graphicCardTheme,
          motionIntensity,
          transitionStyle,
          captionMode,
          subtitlesEnabled: captionMode !== 'off',
          textEffect,
          fontStyle,
          accentColor,
          brandKicker,
          sfxConfig,
          matchingPreference,
          musicVolumeDb,
          musicDucking,
          sceneHints,
        }),
      });
      const startData = (await startRes.json()) as {
        jobId?: string;
        message?: string;
        error?: string;
      };
      if (!startRes.ok || !startData.jobId) {
        throw new Error(startData.error || 'Failed to start timeline analysis.');
      }

      // 4. Poll async analysis job until completed
      let resolvedSession: ProjectSession | null = null;
      for (let poll = 0; poll < 300; poll++) {
        await new Promise((r) => setTimeout(r, 600));
        const jobRes = await fetch(`/api/analyze-jobs/${startData.jobId}`);
        if (!jobRes.ok) continue;
        const job = (await jobRes.json()) as {
          status: string;
          progress?: number;
          message?: string;
          session?: ProjectSession;
          error?: string;
        };
        if (job.message) setAnalyzePhase(job.message);
        if (job.status === 'completed' && job.session) {
          resolvedSession = job.session;
          break;
        }
        if (job.status === 'failed') {
          throw new Error(job.error || 'Timeline analysis failed.');
        }
      }

      if (!resolvedSession) {
        throw new Error('Timeline analysis timed out. Please try fewer clips or retry.');
      }

      setSession(resolvedSession);
      setCurrentTimeMs(0);
      setIsPlaying(false);
      setActiveSection('preview');
      setTimeout(() => {
        previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    } catch (err: unknown) {
      setErrorMessage(
        err instanceof Error
          ? `${err.message} (Check your network connection and file formats, then retry.)`
          : 'Analysis failed.'
      );
    } finally {
      setIsAnalyzing(false);
      setAnalyzePhase('');
    }
  };

  const handleRunSample = async () => {
    setErrorMessage(null);
    setIsAnalyzing(true);
    setAnalyzePhase('Generating sample story...');

    try {
      const res = await fetch('/api/sample', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aspectRatio,
          pacingMode,
          graphicCardTheme,
          motionIntensity,
          transitionStyle,
          captionMode,
          subtitlesEnabled: captionMode !== 'off',
          textEffect,
          fontStyle,
          accentColor,
          brandKicker: brandKicker || '@scenesync.studio',
          sfxConfig,
          matchingPreference,
        }),
      });
      const data = (await res.json()) as ProjectSession & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate sample project.');
      }

      setScript(data.rawScript);
      setBrandKicker(data.brandKicker);
      setSession(data);
      setCurrentTimeMs(0);
      setIsPlaying(false);
      setActiveSection('preview');
      setTimeout(() => {
        previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 80);
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : 'Sample generation failed.');
    } finally {
      setIsAnalyzing(false);
      setAnalyzePhase('');
    }
  };

  const persistSessionUpdate = useCallback(
    async (
      nextSession: ProjectSession,
      recalculateTimings = false,
      clearMusic = false
    ): Promise<void> => {
      setIsSaving(true);
      try {
        const res = await fetch(`/api/projects/${nextSession.id}/realign`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aspectRatio: nextSession.aspectRatio,
            motionIntensity: nextSession.motionIntensity,
            transitionStyle: nextSession.transitionStyle,
            captionMode: nextSession.captionMode,
            subtitlesEnabled: nextSession.captionMode !== 'off',
            textEffect: nextSession.textEffect,
            fontStyle: nextSession.fontStyle,
            accentColor: nextSession.accentColor,
            brandKicker: nextSession.brandKicker,
            sfxConfig: nextSession.sfxConfig,
            backgroundMusic: clearMusic ? null : nextSession.backgroundMusic,
            scenes: nextSession.scenes,
            recalculateTimings,
          }),
        });
        if (res.ok) {
          const updated = (await res.json()) as ProjectSession;
          setSession(updated);
        }
      } finally {
        setIsSaving(false);
      }
    },
    []
  );

  const handleUpdateScene = useCallback(
    (sceneId: string, patch: Partial<SceneItem>, rebalanceTimings = false) => {
      setSession((prev) => {
        if (!prev) return prev;
        const nextScenes = prev.scenes.map((s) =>
          s.id === sceneId ? { ...s, ...patch } : s
        );
        const updated: ProjectSession = { ...prev, scenes: nextScenes };
        void persistSessionUpdate(updated, rebalanceTimings);
        return updated;
      });
    },
    [persistSessionUpdate]
  );

  const handleSelectPhotoForScene = useCallback(
    (sceneId: string, newImageId: string) => {
      setSession((prev) => {
        if (!prev) return prev;
        const targetImg = prev.images.find((img) => img.id === newImageId);
        const nextScenes = prev.scenes.map((s) =>
          s.id === sceneId
            ? {
                ...s,
                beatKind: s.beatKind === 'graphic-card' ? 'media' : s.beatKind,
                imageId: newImageId,
                matchReason: targetImg
                  ? `Manually swapped to ${targetImg.originalName}: ${targetImg.visualSummary}`
                  : s.matchReason,
              }
            : s
        );
        const updated: ProjectSession = { ...prev, scenes: nextScenes };
        void persistSessionUpdate(updated, false);
        return updated;
      });
    },
    [persistSessionUpdate]
  );

  const handleSplitScene = useCallback(
    (sceneId: string) => {
      setSession((prev) => {
        if (!prev) return prev;
        const idx = prev.scenes.findIndex((s) => s.id === sceneId);
        if (idx === -1) return prev;

        const target = prev.scenes[idx];
        const words = target.text.trim().split(/\s+/);
        if (words.length < 4) return prev;

        const mid = Math.ceil(words.length / 2);
        const firstText = words.slice(0, mid).join(' ');
        const secondText = words.slice(mid).join(' ');

        const firstHalf: SceneItem = {
          ...target,
          text: firstText,
        };
        const secondHalf: SceneItem = {
          ...target,
          id: `${target.id}_split_${Date.now().toString(36)}`,
          text: secondText,
          sfxCue: 'shutter',
          matchReason: `Split from Beat ${idx + 1} — click Swap Media to assign another photo`,
        };

        const nextScenes = [
          ...prev.scenes.slice(0, idx),
          firstHalf,
          secondHalf,
          ...prev.scenes.slice(idx + 1),
        ];
        const updated: ProjectSession = { ...prev, scenes: nextScenes };
        void persistSessionUpdate(updated, true);
        return updated;
      });
    },
    [persistSessionUpdate]
  );

  const handleMergeWithNext = useCallback(
    (sceneId: string) => {
      setSession((prev) => {
        if (!prev) return prev;
        const idx = prev.scenes.findIndex((s) => s.id === sceneId);
        if (idx === -1 || idx >= prev.scenes.length - 1) return prev;

        const current = prev.scenes[idx];
        const next = prev.scenes[idx + 1];
        const merged: SceneItem = {
          ...current,
          text: `${current.text.trim()} ${next.text.trim()}`.trim(),
          emotionalWeight: Math.max(current.emotionalWeight, next.emotionalWeight),
        };

        const nextScenes = [
          ...prev.scenes.slice(0, idx),
          merged,
          ...prev.scenes.slice(idx + 2),
        ];
        const updated: ProjectSession = { ...prev, scenes: nextScenes };
        void persistSessionUpdate(updated, true);
        return updated;
      });
    },
    [persistSessionUpdate]
  );

  const handleMoveScene = useCallback(
    (sceneId: string, direction: 'up' | 'down') => {
      setSession((prev) => {
        if (!prev) return prev;
        const idx = prev.scenes.findIndex((s) => s.id === sceneId);
        const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
        if (idx === -1 || swapIdx < 0 || swapIdx >= prev.scenes.length) return prev;

        const copy = [...prev.scenes];
        const temp = copy[idx];
        copy[idx] = copy[swapIdx];
        copy[swapIdx] = temp;

        const updated: ProjectSession = { ...prev, scenes: copy };
        void persistSessionUpdate(updated, true);
        return updated;
      });
    },
    [persistSessionUpdate]
  );

  const handleSessionAspectRatio = useCallback(
    (ratio: AspectRatio) => {
      setAspectRatio(ratio);
      setSession((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, aspectRatio: ratio };
        void persistSessionUpdate(updated, false);
        return updated;
      });
    },
    [persistSessionUpdate]
  );

  const handleSessionMotionIntensity = useCallback(
    (intensity: MotionIntensity) => {
      setMotionIntensity(intensity);
      setSession((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, motionIntensity: intensity };
        void persistSessionUpdate(updated, false);
        return updated;
      });
    },
    [persistSessionUpdate]
  );

  const handleSessionTransitionStyle = useCallback(
    (style: TransitionStyle) => {
      setTransitionStyle(style);
      setSession((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, transitionStyle: style };
        void persistSessionUpdate(updated, false);
        return updated;
      });
    },
    [persistSessionUpdate]
  );

  const handleSessionCaptionMode = useCallback(
    (mode: CaptionMode) => {
      setCaptionMode(mode);
      setSession((prev) => {
        if (!prev) return prev;
        const updated = {
          ...prev,
          captionMode: mode,
          subtitlesEnabled: mode !== 'off',
        };
        void persistSessionUpdate(updated, false);
        return updated;
      });
    },
    [persistSessionUpdate]
  );

  const handleSessionTextEffect = useCallback(
    (effect: TextEffectId) => {
      setTextEffect(effect);
      setSession((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, textEffect: effect };
        void persistSessionUpdate(updated, false);
        return updated;
      });
    },
    [persistSessionUpdate]
  );

  const handleSessionFontStyle = useCallback(
    (font: FontStyleId) => {
      setFontStyle(font);
      setSession((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, fontStyle: font };
        void persistSessionUpdate(updated, false);
        return updated;
      });
    },
    [persistSessionUpdate]
  );

  const handleSessionAccentColor = useCallback(
    (color: AccentColorId) => {
      setAccentColor(color);
      setSession((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, accentColor: color };
        void persistSessionUpdate(updated, false);
        return updated;
      });
    },
    [persistSessionUpdate]
  );

  const handleSessionBrandKicker = useCallback(
    (kicker: string) => {
      setBrandKicker(kicker);
      setSession((prev) => {
        if (!prev) return prev;
        const updated = { ...prev, brandKicker: kicker };
        void persistSessionUpdate(updated, false);
        return updated;
      });
    },
    [persistSessionUpdate]
  );

  const handleUpdateSfxConfig = useCallback(
    (patch: Partial<SfxConfig>) => {
      setSfxConfig((prev) => ({ ...prev, ...patch }));
      setSession((prev) => {
        if (!prev) return prev;
        const updated = {
          ...prev,
          sfxConfig: { ...prev.sfxConfig, ...patch },
        };
        void persistSessionUpdate(updated, false);
        return updated;
      });
    },
    [persistSessionUpdate]
  );

  const handleUpdateMusicSettings = useCallback(
    (patch: Partial<BackgroundMusicTrack>) => {
      if (typeof patch.volumeDb === 'number') setMusicVolumeDb(patch.volumeDb);
      if (typeof patch.duckingEnabled === 'boolean') setMusicDucking(patch.duckingEnabled);
      setSession((prev) => {
        if (!prev || !prev.backgroundMusic) return prev;
        const updated: ProjectSession = {
          ...prev,
          backgroundMusic: { ...prev.backgroundMusic, ...patch },
        };
        void persistSessionUpdate(updated, false);
        return updated;
      });
    },
    [persistSessionUpdate]
  );

  const handleUploadMusicToSession = useCallback(
    async (file: File) => {
      setMusicFile(file);
      if (!session) return;
      setIsSaving(true);
      try {
        const fd = new FormData();
        fd.append('music', file);
        fd.append('volumeDb', String(musicVolumeDb));
        fd.append('duckingEnabled', String(musicDucking));
        const res = await fetch(`/api/projects/${session.id}/music`, {
          method: 'POST',
          body: fd,
        });
        if (res.ok) {
          const updated = (await res.json()) as ProjectSession;
          setSession(updated);
        }
      } finally {
        setIsSaving(false);
      }
    },
    [session, musicVolumeDb, musicDucking]
  );

  const handleRemoveMusicFromSession = useCallback(() => {
    setMusicFile(null);
    setSession((prev) => {
      if (!prev) return prev;
      const updated = { ...prev, backgroundMusic: undefined };
      void persistSessionUpdate(updated, false, true);
      return updated;
    });
  }, [persistSessionUpdate]);

  const handleRebalanceAll = useCallback(() => {
    if (!session) return;
    void persistSessionUpdate(session, true);
  }, [session, persistSessionUpdate]);

  const handleStartExport = async () => {
    if (!session) return;

    eventSourceRef.current?.close();
    setExportModalOpen(true);
    setRenderJob({
      jobId: 'pending',
      projectId: session.id,
      status: 'queued',
      progress: 1,
      currentScene: 0,
      totalScenes: session.scenes.length,
      stage: 'Starting export',
      message: 'Connecting to local FFmpeg render pipeline...',
      encoderUsed: selectedEncoderId,
      elapsedMs: 0,
    });

    try {
      const res = await fetch(`/api/projects/${session.id}/export`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aspectRatio: session.aspectRatio,
          motionIntensity: session.motionIntensity,
          transitionStyle: session.transitionStyle,
          captionMode: session.captionMode,
          subtitlesEnabled: session.captionMode !== 'off',
          textEffect: session.textEffect,
          fontStyle: session.fontStyle,
          accentColor: session.accentColor,
          brandKicker: session.brandKicker,
          sfxConfig: session.sfxConfig,
          encoderId: selectedEncoderId,
          scenes: session.scenes,
        }),
      });

      const data = (await res.json()) as {
        jobId?: string;
        state?: RenderJobState;
        error?: string;
      };
      if (!res.ok || !data.jobId) {
        throw new Error(data.error || 'Could not start export job.');
      }

      if (data.state) setRenderJob(data.state);

      const jobId = data.jobId;
      let stopped = false;

      const pollTimer = window.setInterval(async () => {
        if (stopped) return;
        try {
          const stRes = await fetch(`/api/jobs/${jobId}`, { credentials: 'include' });
          if (!stRes.ok) return;
          const nextState = (await stRes.json()) as RenderJobState;
          setRenderJob(nextState);
          if (nextState.status === 'completed') {
            setRecentExport(nextState);
          }
          if (nextState.status === 'completed' || nextState.status === 'failed') {
            stopped = true;
            window.clearInterval(pollTimer);
            es.close();
          }
        } catch {
          // Keep polling
        }
      }, 1800);

      const es = new EventSource(`/api/jobs/${jobId}/events`);
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const nextState = JSON.parse(event.data) as RenderJobState;
          setRenderJob(nextState);
          if (nextState.status === 'completed') {
            setRecentExport(nextState);
          }
          if (nextState.status === 'completed' || nextState.status === 'failed') {
            stopped = true;
            window.clearInterval(pollTimer);
            es.close();
          }
        } catch {
          // Ignore malformed keepalive chunks
        }
      };

      es.onerror = () => {
        es.close();
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Export initialization failed.';
      setRenderJob((prev) =>
        prev
          ? { ...prev, status: 'failed', stage: 'Export failed', message: msg, error: msg }
          : null
      );
    }
  };

  const activeSceneId = useMemo(() => {
    if (!session) return undefined;
    const found = session.scenes.find(
      (s) => currentTimeMs >= s.startMs && currentTimeMs < s.endMs
    );
    return (found ?? session.scenes[session.scenes.length - 1])?.id;
  }, [session, currentTimeMs]);

  const primaryCanExecute = session
    ? true
    : Boolean(
        intakeTab === 'assemble' &&
          audioFile &&
          script.trim() &&
          imageFiles.length > 0 &&
          !isAnalyzing
      );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-[#0F172A]">
      <TopBar
        hasSession={Boolean(session)}
        activeSection={activeSection}
        onSelectSection={scrollToSection}
        onPrimaryAction={session ? handleStartExport : handleRunAnalysis}
        primaryLabel={session ? 'Export 1080p MP4' : 'Generate Timeline'}
        primaryDisabled={!primaryCanExecute}
      />

      <main className="pb-16">
        {recentExport && !exportModalOpen && (
          <div className="mx-auto max-w-[1440px] px-6 pt-5">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-2.5 text-xs text-[#166534]">
              <span>
                Latest mastered 1080p MP4 is ready on disk
                {recentExport.fileSizeBytes
                  ? ` (${(recentExport.fileSizeBytes / (1024 * 1024)).toFixed(1)} MB)`
                  : ''}
                .
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRenderJob(recentExport);
                    setExportModalOpen(true);
                  }}
                  className="rounded-md bg-[#16A34A] px-3 py-1 font-semibold text-white hover:bg-[#15803D] whitespace-nowrap"
                >
                  Open Download Studio
                </button>
                <button
                  type="button"
                  onClick={() => setRecentExport(null)}
                  className="text-[#166534] hover:underline whitespace-nowrap"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}
        <div ref={intakeRef}>
          <IntakeWorkspace
            activeTab={intakeTab}
            onChangeTab={setIntakeTab}
            blueprintNotice={blueprintNotice}
            onDismissBlueprintNotice={() => setBlueprintNotice(null)}
            onSendBlueprintToAssembler={handleSendBlueprintToAssembler}
            audioFile={audioFile}
            onSelectAudio={setAudioFile}
            musicFile={musicFile}
            onSelectMusic={setMusicFile}
            musicVolumeDb={musicVolumeDb}
            onChangeMusicVolumeDb={setMusicVolumeDb}
            musicDucking={musicDucking}
            onChangeMusicDucking={setMusicDucking}
            script={script}
            onChangeScript={setScript}
            imageFiles={imageFiles}
            onAddImages={handleAddImages}
            onRemoveImage={handleRemoveImage}
            onClearImages={handleClearImages}
            aspectRatio={session?.aspectRatio ?? aspectRatio}
            onChangeAspectRatio={handleSessionAspectRatio}
            pacingMode={pacingMode}
            onChangePacingMode={setPacingMode}
            graphicCardTheme={graphicCardTheme}
            onChangeGraphicCardTheme={setGraphicCardTheme}
            motionIntensity={session?.motionIntensity ?? motionIntensity}
            onChangeMotionIntensity={handleSessionMotionIntensity}
            transitionStyle={session?.transitionStyle ?? transitionStyle}
            onChangeTransitionStyle={handleSessionTransitionStyle}
            captionMode={session?.captionMode ?? captionMode}
            onChangeCaptionMode={handleSessionCaptionMode}
            textEffect={session?.textEffect ?? textEffect}
            onChangeTextEffect={handleSessionTextEffect}
            fontStyle={session?.fontStyle ?? fontStyle}
            onChangeFontStyle={handleSessionFontStyle}
            accentColor={session?.accentColor ?? accentColor}
            onChangeAccentColor={handleSessionAccentColor}
            brandKicker={session?.brandKicker ?? brandKicker}
            onChangeBrandKicker={handleSessionBrandKicker}
            sfxConfig={session?.sfxConfig ?? sfxConfig}
            onChangeSfxConfig={handleUpdateSfxConfig}
            matchingPreference={matchingPreference}
            onChangeMatchingPreference={setMatchingPreference}
            selectedEncoderId={selectedEncoderId}
            onChangeEncoderId={setSelectedEncoderId}
            capabilities={capabilities}
            isAnalyzing={isAnalyzing}
            analyzePhase={analyzePhase}
            errorMessage={errorMessage}
            onRunAnalysis={handleRunAnalysis}
            onRunSample={handleRunSample}
          />
        </div>

        {session && (
          <div className="mx-auto max-w-[1440px] space-y-6 px-6">
            <div ref={previewRef} className="scroll-mt-20">
              <SyncPreviewPlayer
                session={session}
                currentTimeMs={currentTimeMs}
                isPlaying={isPlaying}
                onTimeUpdate={setCurrentTimeMs}
                onPlayStateChange={setIsPlaying}
                onSelectAspectRatio={handleSessionAspectRatio}
                onSelectMotionIntensity={handleSessionMotionIntensity}
                onSelectTransitionStyle={handleSessionTransitionStyle}
                onSelectCaptionMode={handleSessionCaptionMode}
                onSelectTextEffect={handleSessionTextEffect}
                onSelectFontStyle={handleSessionFontStyle}
                onSelectAccentColor={handleSessionAccentColor}
                onChangeBrandKicker={handleSessionBrandKicker}
                onUpdateSfxConfig={handleUpdateSfxConfig}
                onUpdateMusicSettings={handleUpdateMusicSettings}
                onUploadMusicFile={handleUploadMusicToSession}
                onRemoveMusic={handleRemoveMusicFromSession}
                onJumpToScene={(scene) => {
                  setCurrentTimeMs(scene.startMs);
                }}
              />
            </div>

            <div ref={timelineRef} className="scroll-mt-20">
              <StoryboardTimeline
                session={session}
                activeSceneId={activeSceneId}
                isSaving={isSaving}
                onJumpToScene={(scene) => {
                  setCurrentTimeMs(scene.startMs);
                  previewRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }}
                onOpenSwapDrawer={(scene) => setSwapTargetScene(scene)}
                onUpdateScene={handleUpdateScene}
                onSplitScene={handleSplitScene}
                onMergeWithNext={handleMergeWithNext}
                onMoveScene={handleMoveScene}
                onRebalanceAll={handleRebalanceAll}
              />
            </div>
          </div>
        )}
      </main>

      {session && (
        <PhotoSwapDrawer
          isOpen={Boolean(swapTargetScene)}
          targetScene={swapTargetScene}
          images={session.images}
          scenes={session.scenes}
          onClose={() => setSwapTargetScene(null)}
          onSelectPhoto={handleSelectPhotoForScene}
        />
      )}

      <ExportModal
        isOpen={exportModalOpen}
        jobState={renderJob}
        onClose={() => setExportModalOpen(false)}
      />
    </div>
  );
}
