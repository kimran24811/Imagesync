import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Music,
  Pause,
  Play,
  Sparkles,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  AccentColorId,
  AspectRatio,
  BackgroundMusicTrack,
  CaptionMode,
  FocalCropRegion,
  FontStyleId,
  GraphicCardData,
  MotionIntensity,
  ProjectSession,
  SceneItem,
  SfxConfig,
  TextEffectId,
  TransitionStyle,
} from '../types/studio';
import {
  ACCENT_COLOR_HEX,
  getActiveDynamicFrame,
  type DynamicCaptionFrame,
} from '../utils/captions';
import {
  ALL_ACTIVE_SFX_CUES,
  computeSfxSchedule,
  type ActiveSfxCue,
} from '../utils/sfxSchedule';
import { formatDurationSec, formatTimecodeMs } from '../utils/time';

interface SyncPreviewPlayerProps {
  session: ProjectSession;
  currentTimeMs: number;
  isPlaying: boolean;
  onTimeUpdate: (ms: number) => void;
  onPlayStateChange: (playing: boolean) => void;
  onSelectAspectRatio: (ratio: AspectRatio) => void;
  onSelectMotionIntensity: (intensity: MotionIntensity) => void;
  onSelectTransitionStyle: (style: TransitionStyle) => void;
  onSelectCaptionMode: (mode: CaptionMode) => void;
  onSelectTextEffect: (effect: TextEffectId) => void;
  onSelectFontStyle: (font: FontStyleId) => void;
  onSelectAccentColor: (color: AccentColorId) => void;
  onChangeBrandKicker: (kicker: string) => void;
  onUpdateSfxConfig: (patch: Partial<SfxConfig>) => void;
  onUpdateMusicSettings: (patch: Partial<BackgroundMusicTrack>) => void;
  onUploadMusicFile: (file: File) => void;
  onRemoveMusic: () => void;
  onJumpToScene: (scene: SceneItem) => void;
}

function interpolateStatValue(target: string, progress: number): string {
  if (progress >= 0.999) return target;
  const match = target.match(/^([^0-9]*)([\d,.]+)(.*)$/);
  if (!match) return target;
  const prefix = match[1] ?? '';
  const numStr = match[2];
  const suffix = match[3] ?? '';
  const hasComma = numStr.includes(',');
  const decimalMatch = numStr.match(/\.(\d+)/);
  const decimals = decimalMatch ? decimalMatch[1].length : 0;
  const cleanVal = Number(numStr.replace(/,/g, ''));
  if (!Number.isFinite(cleanVal)) return target;

  const eased = 1 - Math.pow(1 - progress, 2.4);
  const curVal = cleanVal * eased;
  let formatted = decimals > 0 ? curVal.toFixed(decimals) : String(Math.round(curVal));
  if (hasComma && decimals === 0) {
    formatted = Number(formatted).toLocaleString('en-US');
  }
  return `${prefix}${formatted}${suffix}`;
}

function getFocalCropTransform(crop: FocalCropRegion | undefined): {
  objectPosition: string;
  cropScale: number;
} {
  switch (crop) {
    case 'left-focus':
      return { objectPosition: '18% 45%', cropScale: 1.48 };
    case 'right-focus':
      return { objectPosition: '82% 45%', cropScale: 1.48 };
    case 'top-hero':
      return { objectPosition: '50% 16%', cropScale: 1.44 };
    case 'bottom-detail':
      return { objectPosition: '50% 82%', cropScale: 1.46 };
    case 'tight-macro':
      return { objectPosition: '50% 48%', cropScale: 1.72 };
    default:
      return { objectPosition: '50% 50%', cropScale: 1 };
  }
}

interface CardPalette {
  bg: string;
  surface: string;
  border: string;
  fg: string;
  muted: string;
  accent: string;
  pillText: string;
  gridColor: string;
}

function resolveCardPalette(
  card: GraphicCardData,
  accentHex: string
): CardPalette {
  if (card.theme === 'cream-poster') {
    return {
      bg: 'linear-gradient(180deg, #FAF6EE 0%, #EFE7D8 100%)',
      surface: '#FFFFFF',
      border: '#D6CCBA',
      fg: '#0F172A',
      muted: '#475569',
      accent: accentHex,
      pillText: '#FFFFFF',
      gridColor: 'rgba(15,23,42,0.06)',
    };
  }
  if (card.theme === 'noir-gold') {
    return {
      bg: 'linear-gradient(180deg, #0D0E12 0%, #050608 100%)',
      surface: '#14161D',
      border: '#2B2F3C',
      fg: '#F8FAFC',
      muted: '#94A3B8',
      accent: '#F59E0B',
      pillText: '#09090B',
      gridColor: 'rgba(255,255,255,0.05)',
    };
  }
  return {
    bg: 'linear-gradient(180deg, #121726 0%, #070A12 100%)',
    surface: '#161D2F',
    border: '#25304A',
    fg: '#FFFFFF',
    muted: '#94A3B8',
    accent: accentHex,
    pillText: '#FFFFFF',
    gridColor: 'rgba(255,255,255,0.05)',
  };
}

export const SyncPreviewPlayer: React.FC<SyncPreviewPlayerProps> = ({
  session,
  currentTimeMs,
  isPlaying,
  onTimeUpdate,
  onPlayStateChange,
  onSelectAspectRatio,
  onSelectMotionIntensity,
  onSelectTransitionStyle,
  onSelectCaptionMode,
  onSelectTextEffect,
  onSelectFontStyle,
  onSelectAccentColor,
  onChangeBrandKicker,
  onUpdateSfxConfig,
  onUpdateMusicSettings,
  onUploadMusicFile,
  onRemoveMusic,
  onJumpToScene,
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const musicInputRef = useRef<HTMLInputElement>(null);
  const rafRef = useRef<number | null>(null);

  // Web Audio procedural SFX buffers for zero-latency preview parity
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sfxBuffersRef = useRef<Partial<Record<ActiveSfxCue, AudioBuffer>>>({});
  const firedCueIdsRef = useRef<Set<string>>(new Set());
  const lastSfxTimeRef = useRef(-1);

  const [isMuted, setIsMuted] = useState(false);
  useEffect(() => () => { void audioCtxRef.current?.close().catch(() => {}); }, []);
  const [imgErrorId, setImgErrorId] = useState<string | null>(null);

  const imagesById = useMemo(
    () => new Map(session.images.map((img) => [img.id, img])),
    [session.images]
  );

  const activeScene = useMemo(() => {
    const found = session.scenes.find(
      (s) => currentTimeMs >= s.startMs && currentTimeMs < s.endMs
    );
    return found ?? session.scenes[session.scenes.length - 1];
  }, [session.scenes, currentTimeMs]);

  const activeMedia = activeScene ? imagesById.get(activeScene.imageId) : undefined;

  const voiceLockedCount = useMemo(
    () => session.scenes.filter((s) => s.alignmentSource === 'voice-locked').length,
    [session.scenes]
  );

  // Shared millisecond-identical SFX schedule matching backend sfxEngine.ts
  const scheduledSfxEvents = useMemo(
    () => computeSfxSchedule(session.scenes, session.sfxConfig, session.audio.durationMs),
    [session.scenes, session.sfxConfig, session.audio.durationMs]
  );

  const ensureSfxBuffersLoaded = useCallback(async () => {
    if (!audioCtxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      audioCtxRef.current = new Ctx();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    await Promise.all(
      ALL_ACTIVE_SFX_CUES.map(async (cue) => {
        if (sfxBuffersRef.current[cue]) return;
        try {
          const res = await fetch(`/api/sfx/${cue}`);
          if (!res.ok) return;
          const arr = await res.arrayBuffer();
          const decoded = await ctx.decodeAudioData(arr);
          sfxBuffersRef.current[cue] = decoded;
        } catch {
          // Non-fatal if SFX decode unavailable
        }
      })
    );
  }, []);

  const triggerSfxCue = useCallback(
    (cue: ActiveSfxCue) => {
      if (isMuted || !session.sfxConfig.enabled) return;
      const ctx = audioCtxRef.current;
      const buf = sfxBuffersRef.current[cue];
      if (!ctx || !buf) return;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      const gain = ctx.createGain();
      const linear = Math.min(1.4, Math.pow(10, (session.sfxConfig.volumeDb ?? -5) / 20));
      gain.gain.value = linear;
      src.connect(gain);
      gain.connect(ctx.destination);
      src.start();
    },
    [isMuted, session.sfxConfig.enabled, session.sfxConfig.volumeDb]
  );

  // Sync voiceover playhead + music ducking + SFX triggers
  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;

    const tick = () => {
      if (audioEl && !audioEl.paused) {
        const nowMs = Math.min(session.audio.durationMs, audioEl.currentTime * 1000);
        onTimeUpdate(nowMs);

        const previousMs = lastSfxTimeRef.current;
        // Sweep between frames: a dropped animation frame must not drop sound design.
        if (nowMs < previousMs - 100) {
          firedCueIdsRef.current.clear();
        }
        for (const ev of scheduledSfxEvents) {
          if (ev.atMs > Math.min(previousMs, nowMs - 1) && ev.atMs <= nowMs && nowMs - ev.atMs < 220) {
            if (!firedCueIdsRef.current.has(ev.id)) {
              firedCueIdsRef.current.add(ev.id);
              triggerSfxCue(ev.cue);
            }
          }
        }
        lastSfxTimeRef.current = nowMs;

        const musicEl = musicRef.current;
        if (musicEl && session.backgroundMusic) {
          const baseLinear = Math.min(1, Math.pow(10, session.backgroundMusic.volumeDb / 20));
          const insidePause = session.audio.pauses.some(
            (p) => nowMs >= p.startMs && nowMs <= p.endMs
          );
          const duckFactor =
            session.backgroundMusic.duckingEnabled && !insidePause ? 0.36 : 1.0;
          musicEl.volume = isMuted ? 0 : Math.max(0.01, Math.min(1, baseLinear * duckFactor));
        }

        rafRef.current = requestAnimationFrame(tick);
      }
    };

    if (isPlaying) {
      rafRef.current = requestAnimationFrame(tick);
    }
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [
    isPlaying,
    session.audio.durationMs,
    session.audio.pauses,
    session.backgroundMusic,
    scheduledSfxEvents,
    triggerSfxCue,
    isMuted,
    onTimeUpdate,
  ]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    if (isPlaying) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
    }
  }, [isPlaying, activeMedia?.id, activeScene?.id]);

  const togglePlay = async () => {
    const audioEl = audioRef.current;
    const musicEl = musicRef.current;
    if (!audioEl) return;

    if (audioEl.paused) {
      await ensureSfxBuffersLoaded();
      if (audioEl.currentTime * 1000 >= session.audio.durationMs - 40) {
        audioEl.currentTime = 0;
        if (musicEl) musicEl.currentTime = 0;
        firedCueIdsRef.current.clear();
        lastSfxTimeRef.current = -1;
        onTimeUpdate(0);
      }
      try {
        await audioEl.play();
        if (musicEl && session.backgroundMusic) {
          musicEl.currentTime = audioEl.currentTime % Math.max(1, musicEl.duration || 30);
          musicEl.play().catch(() => {});
        }
        onPlayStateChange(true);
      } catch {
        onPlayStateChange(false);
      }
    } else {
      audioEl.pause();
      musicEl?.pause();
      onPlayStateChange(false);
    }
  };

  const seekToMs = (ms: number) => {
    const clamped = Math.max(0, Math.min(session.audio.durationMs, ms));
    firedCueIdsRef.current.clear();
    lastSfxTimeRef.current = clamped - 1;
    if (audioRef.current) {
      audioRef.current.currentTime = clamped / 1000;
    }
    if (musicRef.current && musicRef.current.duration) {
      musicRef.current.currentTime = (clamped / 1000) % musicRef.current.duration;
    }
    onTimeUpdate(clamped);
  };

  const handleWaveformClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    seekToMs(ratio * session.audio.durationMs);
  };

  const stepScene = (delta: number) => {
    if (!activeScene) return;
    const nextIdx = Math.max(
      0,
      Math.min(session.scenes.length - 1, activeScene.index + delta)
    );
    const target = session.scenes[nextIdx];
    seekToMs(target.startMs);
    onJumpToScene(target);
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    if (audioRef.current) audioRef.current.muted = nextMuted;
    if (musicRef.current) musicRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  const progressRatio =
    session.audio.durationMs > 0
      ? Math.min(1, Math.max(0, currentTimeMs / session.audio.durationMs))
      : 0;

  const isGraphicCard = activeScene?.beatKind === 'graphic-card';

  const kbClass =
    session.motionIntensity === 'none' ||
    !activeScene ||
    isGraphicCard ||
    activeMedia?.mediaType === 'video'
      ? ''
      : `kb-anim-${activeScene.kenBurnsDirection}`;

  const kbDurationSec = activeScene
    ? Math.max(0.45, activeScene.durationMs / 1000)
    : 2.2;

  const focalCropTransform = getFocalCropTransform(activeScene?.focalCrop);

  const accentHex = ACCENT_COLOR_HEX[session.accentColor]?.hex ?? '#F43F5E';

  const effectiveCaptionMode =
    !session.subtitlesEnabled || session.captionMode === 'off'
      ? 'off'
      : session.captionMode;

  const textEffect: TextEffectId = session.textEffect || 'type-reveal';
  const fontStyle: FontStyleId = session.fontStyle || 'modern-sans';

  const activeFrame = useMemo(() => {
    if (!activeScene || effectiveCaptionMode === 'off' || isGraphicCard) return null;
    return getActiveDynamicFrame(
      activeScene,
      currentTimeMs,
      effectiveCaptionMode,
      textEffect,
      session.aspectRatio
    );
  }, [activeScene, effectiveCaptionMode, isGraphicCard, currentTimeMs, textEffect, session.aspectRatio]);

  const getBodyFontClass = (rtl: boolean) => {
    if (rtl) return 'font-arabic-sans';
    switch (fontStyle) {
      case 'editorial-serif':
        return 'font-editorial-serif';
      case 'mono-tech':
        return 'font-mono';
      default:
        return 'font-display';
    }
  };

  const getAccentFontClass = (rtl: boolean) => {
    if (rtl) return 'font-arabic-sans';
    switch (fontStyle) {
      case 'mixed-editorial':
      case 'editorial-serif':
        return 'font-editorial-serif';
      case 'mono-tech':
        return 'font-mono';
      default:
        return 'font-display';
    }
  };

  const getEffectAnimationClass = () => {
    switch (textEffect) {
      case 'slide-up':
        return 'caption-slide-enter';
      case 'punch-pop':
      case 'type-reveal':
      case 'kinetic-karaoke':
        return 'caption-pop-enter';
      default:
        return '';
    }
  };

  const renderDynamicWords = (frame: DynamicCaptionFrame, enlargeAccent: boolean) => {
    return frame.words.map((tok, idx) => {
      let color = '#FFFFFF';
      let scale = '1em';

      if (textEffect === 'kinetic-karaoke') {
        if (tok.isActiveWord) {
          color = accentHex;
          scale = enlargeAccent ? '1.22em' : '1.1em';
        } else if (tok.isAccent || tok.isNumeric) {
          color = '#FFFFFF';
          scale = '1.08em';
        } else {
          color = 'rgba(226, 232, 240, 0.72)';
        }
      } else {
        const highlight = tok.isAccent || (textEffect === 'type-reveal' && tok.isActiveWord);
        if (tok.isNumeric && enlargeAccent) {
          color = accentHex;
          scale = '1.25em';
        } else if (highlight) {
          color = accentHex;
          scale = enlargeAccent ? '1.18em' : '1.08em';
        }
      }

      const useAccentFont =
        tok.isAccent || (textEffect === 'kinetic-karaoke' && tok.isActiveWord);

      return (
        <React.Fragment key={`${frame.id}_w${idx}`}>
          {idx > 0 ? ' ' : ''}
          <span
            className={useAccentFont ? getAccentFontClass(frame.isRtl) : undefined}
            style={{
              color,
              fontSize: scale,
              transition: 'color 80ms ease',
            }}
          >
            {tok.display}
          </span>
        </React.Fragment>
      );
    });
  };

  // Render programmatic $0 Graphic Card plate matching FFmpeg librsvg cardRenderer.ts
  const renderGraphicCardPlate = (scene: SceneItem) => {
    const card: GraphicCardData = scene.graphicCard ?? {
      cardType: 'statement',
      theme: 'obsidian',
      headline: scene.text,
      kicker: scene.kicker,
    };
    const pal = resolveCardPalette(card, accentHex);
    const beatElapsed = Math.max(0, currentTimeMs - scene.startMs);
    const rollProgress = Math.min(
      1,
      Math.max(0.18, beatElapsed / Math.max(220, scene.durationMs * 0.56))
    );
    const isPortrait = session.aspectRatio === '9:16';

    return (
      <div
        key={`card_${scene.id}`}
        style={{
          background: pal.bg,
          color: pal.fg,
        }}
        className="card-punch-enter relative flex h-full w-full items-center justify-center overflow-hidden p-5 sm:p-7"
      >
        {/* Subtle vector grid */}
        <div
          aria-hidden="true"
          style={{
            backgroundImage: `linear-gradient(to right, ${pal.gridColor} 1px, transparent 1px), linear-gradient(to bottom, ${pal.gridColor} 1px, transparent 1px)`,
            backgroundSize: '28px 28px',
          }}
          className="pointer-events-none absolute inset-0"
        />

        {/* Hairline poster inset frame matching cardRenderer.ts */}
        <div
          style={{ borderColor: pal.border }}
          className="relative z-10 flex h-full w-full flex-col items-center justify-center rounded-2xl border px-4 py-6 text-center"
        >
          {card.cardType === 'stat-counter' && (
            <>
              {(card.kicker || scene.kicker) && (
                <p
                  style={{ color: pal.accent }}
                  className="font-mono text-[10px] font-bold uppercase tracking-[0.22em]"
                >
                  {card.kicker || scene.kicker}
                </p>
              )}
              <p
                className={`mt-2 font-display font-black tracking-tight tabular-nums leading-none ${
                  isPortrait ? 'text-4xl sm:text-5xl' : 'text-5xl sm:text-6xl'
                }`}
              >
                {interpolateStatValue(card.statValue || card.headline || '100%', rollProgress)}
              </p>
              {card.statUnit && (
                <p
                  style={{ color: pal.muted }}
                  className="mt-2 font-mono text-[11px] font-bold uppercase tracking-[0.18em]"
                >
                  {card.statUnit}
                </p>
              )}
              <div
                style={{ backgroundColor: pal.border }}
                className="mt-4 h-1.5 w-3/4 max-w-[240px] overflow-hidden rounded-full"
              >
                <div
                  style={{
                    backgroundColor: pal.accent,
                    width: `${Math.round((0.2 + 0.8 * rollProgress) * 100)}%`,
                  }}
                  className="h-full rounded-full transition-[width] duration-75"
                />
              </div>
              {card.headline && (
                <p className="mt-4 max-w-[90%] text-sm font-bold leading-snug sm:text-base">
                  {card.headline}
                </p>
              )}
            </>
          )}

          {card.cardType === 'split-contrast' && (
            <div className="flex w-full flex-col items-center justify-center gap-3">
              {card.headline && (
                <p
                  style={{ color: pal.muted }}
                  className="text-xs font-extrabold uppercase tracking-wider sm:text-sm"
                >
                  {card.headline}
                </p>
              )}
              <div
                className={`relative grid w-full items-center gap-2.5 ${
                  isPortrait ? 'grid-cols-1 max-w-[230px]' : 'grid-cols-2 max-w-[460px]'
                }`}
              >
                <div
                  style={{ backgroundColor: pal.surface, borderColor: pal.border }}
                  className="flex min-h-[76px] items-center justify-center rounded-xl border px-3 py-4 text-center text-sm font-black sm:text-lg"
                >
                  {card.leftLabel || 'BEFORE'}
                </div>
                <div
                  style={{ backgroundColor: pal.accent, color: pal.pillText }}
                  className="flex min-h-[76px] items-center justify-center rounded-xl px-3 py-4 text-center text-sm font-black sm:text-lg"
                >
                  {card.rightLabel || 'AFTER'}
                </div>
                <div
                  style={{
                    backgroundColor: pal.surface,
                    borderColor: pal.accent,
                    color: pal.fg,
                  }}
                  className="pointer-events-none absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 font-mono text-[10px] font-black"
                >
                  VS
                </div>
              </div>
            </div>
          )}

          {card.cardType === 'statement' && (() => {
            const words = (card.headline || scene.text).trim().split(/\s+/).filter(Boolean);
            const splitAt = Math.max(1, words.length - Math.min(2, Math.floor(words.length / 2) || 1));
            const topText = words.slice(0, splitAt).join(' ');
            const punchText = words.slice(splitAt).join(' ');
            return (
              <>
                {(card.kicker || scene.kicker) && (
                  <p
                    style={{ color: pal.accent }}
                    className="mb-3 font-mono text-[10px] font-extrabold uppercase tracking-[0.22em]"
                  >
                    {card.kicker || scene.kicker}
                  </p>
                )}
                <div className="max-w-[92%] space-y-1.5">
                  {topText && (
                    <p
                      className={`font-display font-black leading-[1.15] tracking-tight ${
                        isPortrait ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl'
                      }`}
                    >
                      {topText}
                    </p>
                  )}
                  {punchText && (
                    <span
                      style={{ backgroundColor: pal.accent, color: pal.pillText }}
                      className={`inline-block rounded-lg px-3 py-1 font-display font-black leading-[1.15] tracking-tight ${
                        isPortrait ? 'text-xl sm:text-2xl' : 'text-2xl sm:text-3xl'
                      }`}
                    >
                      {punchText}
                    </span>
                  )}
                </div>
              </>
            );
          })()}

          {session.brandKicker && (
            <p
              style={{ color: pal.muted }}
              className="pointer-events-none absolute bottom-3 inset-x-0 text-center text-[11px] font-semibold"
            >
              {session.brandKicker}
            </p>
          )}
        </div>
      </div>
    );
  };

  // Adaptive caption placement on non-card scenes matching subtitleGenerator.ts
  const captionZone = activeScene?.captionZone ?? 'top-banner';

  const avgBeatSec =
    session.scenes.length > 0
      ? (session.audio.durationMs / 1000 / session.scenes.length).toFixed(1)
      : '0.0';

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
      <audio
        ref={audioRef}
        src={session.audio.url}
        preload="auto"
        onEnded={() => {
          musicRef.current?.pause();
          onPlayStateChange(false);
          onTimeUpdate(session.audio.durationMs);
        }}
      />
      {session.backgroundMusic && (
        <audio
          ref={musicRef}
          src={session.backgroundMusic.url}
          loop
          preload="auto"
        />
      )}

      {/* Top Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E8F0] pb-4">
        <div>
          <h2 className="text-base font-semibold text-[#0F172A]">
            Synchronized Stage Preview
          </h2>
          <p className="mt-0.5 text-xs text-[#475569]">
            <span>
              {voiceLockedCount > 0
                ? 'Gemini Acoustic + Vision Locked'
                : session.matchingEngineUsed === 'gemini-4-hydrogen'
                  ? 'Gemini Vision Matched'
                  : 'Rapid Concept-Paced'}
            </span>
            <span aria-hidden="true"> · </span>
            <span className="tabular-time">{session.scenes.length} rapid beats (~{avgBeatSec}s/cut)</span>
            <span aria-hidden="true"> · </span>
            <span className="tabular-time">
              {session.sfxConfig.enabled ? `${scheduledSfxEvents.length} SFX cues` : 'SFX muted'}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg bg-[#F1F5F9] p-1">
            <button
              type="button"
              onClick={() => onSelectAspectRatio('9:16')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                session.aspectRatio === '9:16'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              9:16
            </button>
            <button
              type="button"
              onClick={() => onSelectAspectRatio('16:9')}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                session.aspectRatio === '16:9'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              16:9
            </button>
          </div>

          <div className="inline-flex rounded-lg bg-[#F1F5F9] p-1">
            {(
              [
                ['explainer-kinetic', 'Kinetic'],
                ['word-pop', 'Word-Pop'],
                ['bottom-third', 'Bottom'],
                ['off', 'Off'],
              ] as Array<[CaptionMode, string]>
            ).map(([m, lbl]) => (
              <button
                key={m}
                type="button"
                onClick={() => onSelectCaptionMode(m)}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  effectiveCaptionMode === m
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>

          {effectiveCaptionMode !== 'off' && (
            <>
              <select
                value={textEffect}
                onChange={(e) => onSelectTextEffect(e.target.value as TextEffectId)}
                aria-label="Dynamic text animation effect"
                className="rounded-lg border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
              >
                <option value="type-reveal">Word Reveal</option>
                <option value="kinetic-karaoke">Karaoke</option>
                <option value="punch-pop">Punch Pop</option>
                <option value="slide-up">Slide Up</option>
                <option value="highlight-box">Highlight Box</option>
              </select>

              <select
                value={fontStyle}
                onChange={(e) => onSelectFontStyle(e.target.value as FontStyleId)}
                aria-label="Caption font style"
                className="rounded-lg border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
              >
                <option value="modern-sans">Modern Sans</option>
                <option value="mixed-editorial">Mixed Serif</option>
                <option value="editorial-serif">Editorial Serif</option>
                <option value="mono-tech">Mono</option>
              </select>

              <div className="inline-flex items-center gap-1 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-1">
                {(Object.keys(ACCENT_COLOR_HEX) as AccentColorId[]).map((cKey) => (
                  <button
                    key={cKey}
                    type="button"
                    onClick={() => onSelectAccentColor(cKey)}
                    title={ACCENT_COLOR_HEX[cKey].label}
                    aria-label={ACCENT_COLOR_HEX[cKey].label}
                    style={{ backgroundColor: ACCENT_COLOR_HEX[cKey].hex }}
                    className={`h-4 w-4 rounded-full ${
                      session.accentColor === cKey
                        ? 'ring-2 ring-[#0F172A] ring-offset-1'
                        : 'opacity-70 hover:opacity-100'
                    }`}
                  />
                ))}
              </div>
            </>
          )}

          <div className="inline-flex rounded-lg bg-[#F1F5F9] p-1">
            {(['subtle', 'moderate', 'none'] as MotionIntensity[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => onSelectMotionIntensity(m)}
                className={`rounded-md px-2 py-1 text-xs font-medium capitalize transition-colors whitespace-nowrap shrink-0 ${
                  session.motionIntensity === m
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#475569] hover:text-[#0F172A]'
                }`}
              >
                {m === 'none' ? 'Static' : m}
              </button>
            ))}
          </div>

          <div className="inline-flex rounded-lg bg-[#F1F5F9] p-1">
            <button
              type="button"
              onClick={() => onSelectTransitionStyle('whip-dynamic')}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                session.transitionStyle === 'whip-dynamic'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              Whip Dynamic
            </button>
            <button
              type="button"
              onClick={() => onSelectTransitionStyle('crossfade')}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                session.transitionStyle === 'crossfade'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              Crossfade
            </button>
            <button
              type="button"
              onClick={() => onSelectTransitionStyle('cut')}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                session.transitionStyle === 'cut'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#475569] hover:text-[#0F172A]'
              }`}
            >
              Cut
            </button>
          </div>
        </div>
      </div>

      {/* Video Viewport */}
      <div className="flex justify-center rounded-lg bg-[#0F172A] p-4 sm:p-6">
        <div
          className={`relative overflow-hidden rounded-md bg-black shadow-sm ${
            session.aspectRatio === '9:16'
              ? 'aspect-[9/16] h-[440px] sm:h-[510px]'
              : 'aspect-video w-full max-w-[780px]'
          }`}
        >
          {isGraphicCard && activeScene ? (
            renderGraphicCardPlate(activeScene)
          ) : activeMedia && imgErrorId !== activeMedia.id ? (
            activeMedia.mediaType === 'video' ? (
              <video
                ref={videoRef}
                key={`${activeScene?.id}-${activeMedia.id}`}
                src={activeMedia.url}
                muted
                loop
                playsInline
                autoPlay={isPlaying}
                className="h-full w-full object-cover"
              />
            ) : (
              <div
                className="h-full w-full overflow-hidden"
                style={{
                  transform: `scale(${focalCropTransform.cropScale})`,
                  transformOrigin: focalCropTransform.objectPosition,
                }}
              >
                <img
                  key={`${activeScene?.id}-${activeMedia.id}-${session.motionIntensity}-${activeScene?.kenBurnsDirection}-${activeScene?.focalCrop ?? 'full'}`}
                  src={activeMedia.url}
                  alt={activeMedia.visualSummary}
                  referrerPolicy="no-referrer"
                  onError={() => setImgErrorId(activeMedia.id)}
                  style={{
                    objectPosition: focalCropTransform.objectPosition,
                    animationDuration: `${kbDurationSec}s`,
                    animationPlayState: isPlaying ? 'running' : 'paused',
                  }}
                  className={`h-full w-full object-cover ${kbClass}`}
                />
              </div>
            )
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center bg-[#1E293B] text-[#94A3B8]">
              <ImageOff className="h-8 w-8" aria-hidden="true" />
              <span className="mt-2 text-xs">
                {activeMedia?.originalName ?? 'Scene media'}
              </span>
            </div>
          )}

          {/* Brief Whip-Flash Cut Burst on Dynamic Transitions */}
          {session.transitionStyle === 'whip-dynamic' && activeScene && activeScene.index > 0 && (
            <div
              key={`flash_${activeScene.id}`}
              aria-hidden="true"
              className="whip-flash-overlay pointer-events-none absolute inset-0 bg-white/40"
            />
          )}

          {/* Mode 1: Explainer Kinetic (Zone-aware, mixed scale, RTL/LTR) */}
          {effectiveCaptionMode === 'explainer-kinetic' && activeScene && activeFrame && (
            <div
              dir={activeFrame.isRtl ? 'rtl' : 'ltr'}
              className={`pointer-events-none absolute inset-x-0 ${
                captionZone === 'center-impact'
                  ? 'top-1/2 -translate-y-1/2 text-center px-6 py-4 bg-gradient-to-b from-black/45 via-black/55 to-black/45'
                  : captionZone === 'lower-hero'
                    ? `bottom-0 text-center bg-gradient-to-t from-black/80 via-black/45 to-transparent ${
                        session.aspectRatio === '9:16' ? 'px-5 pb-12 pt-14' : 'px-8 pb-8 pt-12'
                      }`
                    : `top-0 ${activeFrame.isRtl ? 'text-right' : 'text-left'} bg-gradient-to-b from-black/75 via-black/35 to-transparent ${
                        session.aspectRatio === '9:16' ? 'px-5 pt-7 pb-14' : 'px-8 pt-6 pb-12'
                      }`
              }`}
            >
              {captionZone === 'top-banner' && (
                <div
                  className={`flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-[#E2E8F0] ${
                    activeFrame.isRtl ? 'justify-start' : ''
                  }`}
                >
                  <span
                    style={{ backgroundColor: accentHex }}
                    className="inline-block h-1.5 w-1.5 rounded-full"
                  />
                  <span>
                    {session.brandKicker && activeScene.kicker
                      ? `${session.brandKicker} · ${activeScene.kicker}`
                      : session.brandKicker ||
                        activeScene.kicker ||
                        `BEAT ${String(activeScene.index + 1).padStart(2, '0')}`}
                  </span>
                </div>
              )}
              <p
                key={activeFrame.id}
                style={{ textShadow: '0 2px 10px rgba(0,0,0,0.88)' }}
                className={`mt-1.5 font-extrabold leading-[1.15] tracking-tight text-white ${getBodyFontClass(activeFrame.isRtl)} ${getEffectAnimationClass()} ${
                  textEffect === 'highlight-box'
                    ? 'inline-block rounded-md bg-[#0F172A]/85 px-2.5 py-1'
                    : ''
                } ${
                  session.aspectRatio === '9:16'
                    ? 'text-[19px] sm:text-[22px]'
                    : 'text-[24px] mx-auto max-w-[84%]'
                }`}
              >
                {renderDynamicWords(activeFrame, true)}
              </p>
            </div>
          )}

          {/* Mode 2: Centered Word-Pop */}
          {effectiveCaptionMode === 'word-pop' && activeScene && activeFrame && (
            <div
              dir={activeFrame.isRtl ? 'rtl' : 'ltr'}
              className="pointer-events-none absolute inset-x-0 top-[63%] px-5 text-center"
            >
              <p
                key={activeFrame.id}
                style={{ textShadow: '0 2px 12px rgba(0,0,0,0.95)' }}
                className={`inline-block text-2xl font-black tracking-tight text-white sm:text-3xl ${getBodyFontClass(activeFrame.isRtl)} ${getEffectAnimationClass()} ${
                  textEffect === 'highlight-box'
                    ? 'rounded-lg bg-[#0F172A]/88 px-3.5 py-1.5'
                    : ''
                }`}
              >
                {renderDynamicWords(activeFrame, true)}
              </p>
            </div>
          )}

          {/* Mode 3: Clean Bottom-Third Subtitles */}
          {effectiveCaptionMode === 'bottom-third' && activeScene && activeFrame && (
            <div
              dir={activeFrame.isRtl ? 'rtl' : 'ltr'}
              className={`pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/35 to-transparent px-4 pt-10 text-center ${
                session.aspectRatio === '9:16' ? 'pb-12' : 'pb-5'
              }`}
            >
              <p
                key={activeFrame.id}
                style={{ textShadow: '0 1px 4px rgba(0,0,0,0.95)' }}
                className={`mx-auto inline-block max-w-[90%] text-sm font-semibold leading-snug tracking-wide text-white sm:text-[15px] ${getBodyFontClass(activeFrame.isRtl)} ${getEffectAnimationClass()} ${
                  textEffect === 'highlight-box'
                    ? 'rounded-md bg-[#0F172A]/85 px-3 py-1'
                    : ''
                }`}
              >
                {renderDynamicWords(activeFrame, false)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Transport & Audio/SFX Controls */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => stepScene(-1)}
            aria-label="Previous scene"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-[#0F172A] hover:bg-[#F1F5F9]"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={togglePlay}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#2563EB] px-4 text-xs font-semibold text-white hover:bg-[#1D4ED8] whitespace-nowrap shrink-0"
          >
            {isPlaying ? (
              <>
                <Pause className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Play Preview</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => stepScene(1)}
            aria-label="Next scene"
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-[#0F172A] hover:bg-[#F1F5F9]"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="tabular-time text-xs font-medium text-[#0F172A]">
          <span>{formatTimecodeMs(currentTimeMs)}</span>
          <span className="mx-1.5 text-[#94A3B8]">/</span>
          <span className="text-[#475569]">{formatTimecodeMs(session.audio.durationMs)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {effectiveCaptionMode === 'explainer-kinetic' && (
            <input
              type="text"
              value={session.brandKicker}
              onChange={(e) => onChangeBrandKicker(e.target.value)}
              placeholder="@handle"
              aria-label="Top kicker brand handle"
              className="h-9 w-28 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:bg-white focus:outline-none"
            />
          )}

          <button
            type="button"
            onClick={() =>
              onUpdateSfxConfig({ enabled: !session.sfxConfig.enabled })
            }
            className={`inline-flex h-9 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
              session.sfxConfig.enabled
                ? 'border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]'
                : 'border-[#E2E8F0] bg-white text-[#475569] hover:text-[#0F172A]'
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{session.sfxConfig.enabled ? 'SFX On' : 'SFX Off'}</span>
          </button>

          <input
            ref={musicInputRef}
            type="file"
            accept=".mp3,.wav,.m4a,.ogg,.aac,audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onUploadMusicFile(f);
              e.target.value = '';
            }}
          />

          {session.backgroundMusic ? (
            <div className="inline-flex items-center gap-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2.5 py-1.5 text-xs">
              <Music className="h-3.5 w-3.5 text-[#2563EB]" aria-hidden="true" />
              <span className="max-w-[95px] truncate font-medium text-[#0F172A]">
                {session.backgroundMusic.filename}
              </span>
              <input
                type="range"
                min={-26}
                max={-6}
                step={1}
                value={session.backgroundMusic.volumeDb}
                onChange={(e) =>
                  onUpdateMusicSettings({ volumeDb: Number(e.target.value) })
                }
                aria-label="Background music volume"
                className="h-1.5 w-14 accent-[#2563EB]"
              />
              <button
                type="button"
                onClick={onRemoveMusic}
                className="text-[#DC2626] hover:underline whitespace-nowrap shrink-0"
              >
                Remove
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => musicInputRef.current?.click()}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-white px-3 text-xs font-medium text-[#475569] hover:text-[#0F172A] whitespace-nowrap shrink-0"
            >
              <Music className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Music Bed</span>
            </button>
          )}

          <button
            type="button"
            onClick={toggleMute}
            aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#E2E8F0] bg-white text-[#475569] hover:text-[#0F172A]"
          >
            {isMuted ? (
              <VolumeX className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Volume2 className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {/* Scrubbable Audio Waveform & Proportional Scene Strip */}
      <div className="mt-4 select-none">
        <div
          onClick={handleWaveformClick}
          role="slider"
          aria-label="Voiceover timeline scrubber"
          aria-valuemin={0}
          aria-valuemax={session.audio.durationMs}
          aria-valuenow={Math.round(currentTimeMs)}
          tabIndex={0}
          className="relative h-16 w-full cursor-pointer overflow-hidden rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-1"
        >
          {session.audio.pauses.map((pause, idx) => {
            const leftPct = (pause.startMs / session.audio.durationMs) * 100;
            const widthPct = Math.max(0.4, (pause.durationMs / session.audio.durationMs) * 100);
            return (
              <div
                key={`pause_${idx}`}
                title={`Speech pause: ${pause.durationMs}ms`}
                style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                className="pointer-events-none absolute inset-y-0 bg-[#E2E8F0]/70"
              />
            );
          })}

          <div className="relative z-10 flex h-full items-center justify-between gap-[2px]">
            {session.audio.waveformPeaks.map((peak, idx) => {
              const barRatio = idx / session.audio.waveformPeaks.length;
              const isPlayed = barRatio <= progressRatio;
              return (
                <div
                  key={idx}
                  style={{ height: `${Math.max(12, Math.round(peak * 86))}%` }}
                  className={`flex-1 rounded-xs transition-colors ${
                    isPlayed ? 'bg-[#2563EB]' : 'bg-[#CBD5E1]'
                  }`}
                />
              );
            })}
          </div>

          <div
            style={{ left: `${progressRatio * 100}%` }}
            className="pointer-events-none absolute inset-y-0 z-20 w-[2px] bg-[#0F172A]"
          />
        </div>

        <div className="mt-1.5 flex h-7 w-full gap-1">
          {session.scenes.map((scene) => {
            const widthPct = (scene.durationMs / session.audio.durationMs) * 100;
            const isCurrent = activeScene?.id === scene.id;
            const isCard = scene.beatKind === 'graphic-card';
            const isCrop = scene.beatKind === 'crop-cut';
            return (
              <button
                key={scene.id}
                type="button"
                onClick={() => {
                  seekToMs(scene.startMs);
                  onJumpToScene(scene);
                }}
                style={{ width: `${widthPct}%` }}
                title={`Beat ${scene.index + 1} (${formatDurationSec(scene.durationMs)}) · ${
                  isCard ? 'Graphic Card' : isCrop ? `Sub-Crop (${scene.focalCrop})` : 'Media'
                }`}
                className={`flex items-center justify-center truncate rounded-md border px-1 text-[11px] font-medium tabular-time transition-colors ${
                  isCurrent
                    ? 'border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]'
                    : isCard
                      ? 'border-[#CBD5E1] bg-[#0F172A] text-white hover:bg-[#1E293B]'
                      : isCrop
                        ? 'border-[#BFDBFE] bg-[#F8FAFC] text-[#1E40AF] hover:bg-[#EFF6FF]'
                        : 'border-[#E2E8F0] bg-white text-[#475569] hover:bg-[#F1F5F9]'
                }`}
              >
                {String(scene.index + 1).padStart(2, '0')}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};
