import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Film,
  ImageOff,
  Merge,
  RefreshCw,
  Scissors,
  Volume2,
} from 'lucide-react';
import type {
  BeatKind,
  CaptionZone,
  FocalCropRegion,
  GraphicCardTheme,
  GraphicCardType,
  KenBurnsDirection,
  ProjectSession,
  SceneItem,
  SfxCueType,
} from '../types/studio';
import { formatDurationSec, formatTimecodeMs } from '../utils/time';

interface StoryboardTimelineProps {
  session: ProjectSession;
  activeSceneId: string | undefined;
  isSaving: boolean;
  onJumpToScene: (scene: SceneItem) => void;
  onOpenSwapDrawer: (scene: SceneItem) => void;
  onUpdateScene: (sceneId: string, patch: Partial<SceneItem>, rebalanceTimings?: boolean) => void;
  onSplitScene: (sceneId: string) => void;
  onMergeWithNext: (sceneId: string) => void;
  onMoveScene: (sceneId: string, direction: 'up' | 'down') => void;
  onRebalanceAll: () => void;
}

const DIRECTION_LABELS: Record<KenBurnsDirection, string> = {
  'snap-zoom-in': 'Snap Zoom Punch',
  'whip-zoom': 'Whip Zoom',
  'impact-shake': 'Impact Shake',
  'pan-up': 'Pan Up',
  'zoom-in': 'Smooth Zoom In',
  'zoom-out': 'Smooth Zoom Out',
  'pan-left': 'Pan Left',
  'pan-right': 'Pan Right',
};

const FOCAL_CROP_LABELS: Record<FocalCropRegion, string> = {
  full: 'Full Frame',
  'left-focus': 'Left Subject Crop',
  'right-focus': 'Right Subject Crop',
  'top-hero': 'Top Hero Crop',
  'tight-macro': 'Tight Macro Crop',
  'bottom-detail': 'Bottom Detail Crop',
};

const CAPTION_ZONE_LABELS: Record<CaptionZone, string> = {
  'top-banner': 'Top Banner',
  'center-impact': 'Center Impact',
  'lower-hero': 'Lower Hero',
};

const BEAT_KIND_LABELS: Record<BeatKind, string> = {
  media: 'Media Cut',
  'crop-cut': 'Sub-Crop Cut',
  'graphic-card': '$0 Graphic Card',
};

const SFX_LABELS: Record<SfxCueType, string> = {
  impact: 'Hook Boom',
  shutter: 'Camera Shutter',
  flashwhoosh: 'Flash Whip',
  cashtick: 'Stat Cash Tick',
  keyburst: 'Typing Burst',
  whoosh: 'Whoosh Cut',
  pop: 'Text Pop',
  riser: 'Tension Riser',
  glitch: 'Digital Glitch',
  chime: 'Insight Chime',
  typeclick: 'Key Tick',
  thud: 'Heavy Thud',
  none: 'Silent',
};

export const StoryboardTimeline: React.FC<StoryboardTimelineProps> = ({
  session,
  activeSceneId,
  isSaving,
  onJumpToScene,
  onOpenSwapDrawer,
  onUpdateScene,
  onSplitScene,
  onMergeWithNext,
  onMoveScene,
  onRebalanceAll,
}) => {
  const [brokenImages, setBrokenImages] = useState<Record<string, boolean>>({});
  const imagesById = new Map(session.images.map((img) => [img.id, img]));

  const previewSfxCue = (cue: SfxCueType | undefined) => {
    if (!cue || cue === 'none') return;
    const audio = new Audio(`/api/sfx/${cue}`);
    audio.volume = 0.7;
    audio.play().catch(() => {});
  };

  const handleBeatKindChange = (scene: SceneItem, nextKind: BeatKind) => {
    if (nextKind === 'graphic-card') {
      const numMatch = scene.text.match(/[$€£Rs]?\d[\d,.]*(?:%|K|M|B|\+)?/i);
      const cardType: GraphicCardType = numMatch ? 'stat-counter' : 'statement';
      onUpdateScene(
        scene.id,
        {
          beatKind: 'graphic-card',
          focalCrop: 'full',
          graphicCard: scene.graphicCard ?? {
            cardType,
            theme: 'obsidian',
            headline: scene.text,
            statValue: numMatch?.[0] ?? '100%',
            statUnit: numMatch ? 'KEY METRIC' : undefined,
            kicker: scene.kicker || `BEAT ${String(scene.index + 1).padStart(2, '0')}`,
          },
        },
        false
      );
      return;
    }

    if (nextKind === 'crop-cut') {
      onUpdateScene(
        scene.id,
        {
          beatKind: 'crop-cut',
          focalCrop:
            scene.focalCrop && scene.focalCrop !== 'full' ? scene.focalCrop : 'tight-macro',
        },
        false
      );
      return;
    }

    onUpdateScene(
      scene.id,
      {
        beatKind: 'media',
        focalCrop: 'full',
      },
      false
    );
  };

  return (
    <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4 border-b border-[#E2E8F0] pb-4">
        <div>
          <h2 className="text-base font-semibold text-[#0F172A]">
            Rapid Beat Storyboard, Kinetic Cards & SFX Cues
          </h2>
          <p className="mt-0.5 text-xs text-[#475569] tabular-time">
            <span>Total duration locked to {formatTimecodeMs(session.audio.durationMs)}</span>
            <span aria-hidden="true"> · </span>
            <span>{session.scenes.length} micro-beats</span>
            <span aria-hidden="true"> · </span>
            <span>Switch any beat between full media, focal sub-crop, or $0 graphic card</span>
          </p>
        </div>

        <button
          type="button"
          disabled={isSaving}
          onClick={onRebalanceAll}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#CBD5E1] bg-white px-3 py-1.5 text-xs font-medium text-[#0F172A] hover:bg-[#F1F5F9] disabled:opacity-50 whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isSaving ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span>Recalculate Dynamic Timings</span>
        </button>
      </div>

      {session.fallbackNotice && (
        <div className="mb-4 rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-3.5 py-2.5 text-xs text-[#92400E]">
          {session.fallbackNotice}
        </div>
      )}

      <div className="divide-y divide-[#E2E8F0]">
        {session.scenes.map((scene, idx) => {
          const media = imagesById.get(scene.imageId);
          const isCurrent = activeSceneId === scene.id;
          const beatKind: BeatKind = scene.beatKind ?? 'media';
          const isCard = beatKind === 'graphic-card';
          const isCrop = beatKind === 'crop-cut';
          const canSplit = scene.text.trim().split(/\s+/).length >= 3 && scene.durationMs >= 950;
          const canMerge = idx < session.scenes.length - 1;

          return (
            <article
              key={scene.id}
              className={`flex flex-col gap-4 py-4 first:pt-1 last:pb-1 sm:flex-row sm:items-start ${
                isCurrent ? 'bg-[#EFF6FF]/45 -mx-3 px-3 rounded-lg' : ''
              }`}
            >
              {/* Thumbnail + One-Click Swap */}
              <div className="flex shrink-0 flex-col gap-2 sm:w-44">
                <button
                  type="button"
                  onClick={() => onJumpToScene(scene)}
                  className={`group relative aspect-video w-full overflow-hidden rounded-lg border bg-[#0F172A] text-left ${
                    isCurrent ? 'border-[#2563EB] ring-2 ring-[#2563EB]/20' : 'border-[#E2E8F0]'
                  }`}
                >
                  {isCard ? (
                    <div
                      className={`flex h-full w-full flex-col items-center justify-center px-3 text-center ${
                        scene.graphicCard?.theme === 'cream-poster'
                          ? 'bg-[#FAF6EE] text-[#0F172A]'
                          : 'bg-[#0F172A] text-white'
                      }`}
                    >
                      <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-[#F43F5E]">
                        {scene.graphicCard?.cardType === 'stat-counter'
                          ? 'STAT CARD'
                          : scene.graphicCard?.cardType === 'split-contrast'
                            ? 'VS CARD'
                            : 'POSTER CARD'}
                      </span>
                      <span className="mt-0.5 line-clamp-1 text-sm font-black tabular-time">
                        {scene.graphicCard?.cardType === 'stat-counter'
                          ? scene.graphicCard?.statValue || scene.graphicCard?.headline
                          : scene.graphicCard?.headline || scene.text}
                      </span>
                    </div>
                  ) : media && !brokenImages[media.id] ? (
                    <img
                      src={media.thumbUrl}
                      alt={media.visualSummary}
                      referrerPolicy="no-referrer"
                      onError={() =>
                        setBrokenImages((prev) => ({ ...prev, [media.id]: true }))
                      }
                      className={`h-full w-full object-cover transition-transform duration-150 group-hover:scale-105 ${
                        isCrop ? 'scale-125' : ''
                      }`}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[#94A3B8]">
                      <ImageOff className="h-5 w-5" aria-hidden="true" />
                    </div>
                  )}

                  {!isCard && media?.mediaType === 'video' && (
                    <div className="pointer-events-none absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-white tabular-time">
                      <Film className="h-3 w-3" aria-hidden="true" />
                      <span>
                        VIDEO{media.clipDurationMs ? ` · ${(media.clipDurationMs / 1000).toFixed(1)}s` : ''}
                      </span>
                    </div>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => onOpenSwapDrawer(scene)}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] transition-colors hover:border-[#2563EB] hover:text-[#2563EB] whitespace-nowrap"
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Swap Media</span>
                </button>
              </div>

              {/* Spoken Script & Controls */}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-[#475569] tabular-time">
                    <span className="font-semibold text-[#0F172A]">
                      Beat {String(scene.index + 1).padStart(2, '0')}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {formatTimecodeMs(scene.startMs)} – {formatTimecodeMs(scene.endMs)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-[#2563EB]">
                      {formatDurationSec(scene.durationMs)}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span
                      className={
                        isCard
                          ? 'font-medium text-[#0F172A]'
                          : isCrop
                            ? 'font-medium text-[#2563EB]'
                            : scene.alignmentSource === 'voice-locked' || scene.snappedToPause
                              ? 'text-[#16A34A]'
                              : 'text-[#64748B]'
                      }
                    >
                      {isCard
                        ? 'Graphic Card'
                        : isCrop
                          ? FOCAL_CROP_LABELS[scene.focalCrop ?? 'tight-macro']
                          : scene.alignmentSource === 'voice-locked'
                            ? 'Voice-locked'
                            : scene.snappedToPause
                              ? 'Pause-snapped'
                              : 'Concept-paced'}
                    </span>
                    {!isCard && media && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="truncate max-w-[180px] text-[#64748B]">
                          {media.originalName}
                        </span>
                      </>
                    )}
                  </div>

                  {/* Scene Reorder / Split / Merge Toolbar */}
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => onMoveScene(scene.id, 'up')}
                      title="Move beat up"
                      aria-label={`Move beat ${idx + 1} up`}
                      className="rounded-md border border-[#E2E8F0] bg-white p-1.5 text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] disabled:opacity-35 disabled:cursor-not-allowed"
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === session.scenes.length - 1}
                      onClick={() => onMoveScene(scene.id, 'down')}
                      title="Move beat down"
                      aria-label={`Move beat ${idx + 1} down`}
                      className="rounded-md border border-[#E2E8F0] bg-white p-1.5 text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] disabled:opacity-35 disabled:cursor-not-allowed"
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={!canSplit}
                      onClick={() => onSplitScene(scene.id)}
                      title="Split beat into two rapid cuts"
                      className="inline-flex items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-2 py-1 text-xs font-medium text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] disabled:opacity-35 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
                    >
                      <Scissors className="h-3 w-3" aria-hidden="true" />
                      <span>Split</span>
                    </button>
                    {canMerge && (
                      <button
                        type="button"
                        onClick={() => onMergeWithNext(scene.id)}
                        title="Merge with next beat"
                        className="inline-flex items-center gap-1 rounded-md border border-[#E2E8F0] bg-white px-2 py-1 text-xs font-medium text-[#475569] hover:bg-[#F1F5F9] hover:text-[#0F172A] whitespace-nowrap shrink-0"
                      >
                        <Merge className="h-3 w-3" aria-hidden="true" />
                        <span>Merge Next</span>
                      </button>
                    )}
                  </div>
                </div>

                <textarea
                  value={scene.text}
                  onChange={(e) => onUpdateScene(scene.id, { text: e.target.value }, false)}
                  rows={2}
                  aria-label={`Spoken script for beat ${scene.index + 1}`}
                  className="mt-2 w-full resize-none rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-sm leading-relaxed text-[#0F172A] focus:border-[#2563EB] focus:bg-white focus:outline-none"
                />

                <p className="mt-1.5 text-xs text-[#64748B]">
                  {scene.matchReason}
                </p>

                {/* Inline Graphic Card Editor when BeatKind is Graphic Card */}
                {isCard && scene.graphicCard && (
                  <div className="mt-2.5 flex flex-wrap items-center gap-2.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-2.5 text-xs">
                    <label className="inline-flex items-center gap-1.5 text-[#475569]">
                      <span>Card Layout:</span>
                      <select
                        value={scene.graphicCard.cardType}
                        onChange={(e) =>
                          onUpdateScene(
                            scene.id,
                            {
                              graphicCard: {
                                ...scene.graphicCard!,
                                cardType: e.target.value as GraphicCardType,
                              },
                            },
                            false
                          )
                        }
                        className="rounded border border-[#CBD5E1] bg-white px-2 py-1 font-medium text-[#0F172A]"
                      >
                        <option value="stat-counter">Animated Stat Counter</option>
                        <option value="statement">Bold Poster Statement</option>
                        <option value="split-contrast">Split Contrast (VS)</option>
                      </select>
                    </label>

                    <label className="inline-flex items-center gap-1.5 text-[#475569]">
                      <span>Theme:</span>
                      <select
                        value={scene.graphicCard.theme}
                        onChange={(e) =>
                          onUpdateScene(
                            scene.id,
                            {
                              graphicCard: {
                                ...scene.graphicCard!,
                                theme: e.target.value as GraphicCardTheme,
                              },
                            },
                            false
                          )
                        }
                        className="rounded border border-[#CBD5E1] bg-white px-2 py-1 font-medium text-[#0F172A]"
                      >
                        <option value="obsidian">Obsidian Dark</option>
                        <option value="cream-poster">Cream Poster</option>
                        <option value="noir-gold">Noir Gold</option>
                      </select>
                    </label>

                    {scene.graphicCard.cardType === 'stat-counter' && (
                      <>
                        <label className="inline-flex items-center gap-1.5 text-[#475569]">
                          <span>Number:</span>
                          <input
                            type="text"
                            value={scene.graphicCard.statValue ?? ''}
                            onChange={(e) =>
                              onUpdateScene(
                                scene.id,
                                {
                                  graphicCard: {
                                    ...scene.graphicCard!,
                                    statValue: e.target.value,
                                  },
                                },
                                false
                              )
                            }
                            placeholder="200,000"
                            className="w-24 rounded border border-[#CBD5E1] bg-white px-2 py-1 font-mono font-semibold text-[#0F172A]"
                          />
                        </label>
                        <label className="inline-flex items-center gap-1.5 text-[#475569]">
                          <span>Unit:</span>
                          <input
                            type="text"
                            value={scene.graphicCard.statUnit ?? ''}
                            onChange={(e) =>
                              onUpdateScene(
                                scene.id,
                                {
                                  graphicCard: {
                                    ...scene.graphicCard!,
                                    statUnit: e.target.value,
                                  },
                                },
                                false
                              )
                            }
                            placeholder="VIEWS"
                            className="w-24 rounded border border-[#CBD5E1] bg-white px-2 py-1 font-mono font-medium text-[#0F172A]"
                          />
                        </label>
                      </>
                    )}

                    {scene.graphicCard.cardType === 'split-contrast' && (
                      <>
                        <input
                          type="text"
                          value={scene.graphicCard.leftLabel ?? ''}
                          onChange={(e) =>
                            onUpdateScene(
                              scene.id,
                              {
                                graphicCard: {
                                  ...scene.graphicCard!,
                                  leftLabel: e.target.value,
                                },
                              },
                              false
                            )
                          }
                          placeholder="Left label"
                          className="w-24 rounded border border-[#CBD5E1] bg-white px-2 py-1 font-medium text-[#0F172A]"
                        />
                        <span className="font-mono text-[10px] font-bold text-[#64748B]">VS</span>
                        <input
                          type="text"
                          value={scene.graphicCard.rightLabel ?? ''}
                          onChange={(e) =>
                            onUpdateScene(
                              scene.id,
                              {
                                graphicCard: {
                                  ...scene.graphicCard!,
                                  rightLabel: e.target.value,
                                },
                              },
                              false
                            )
                          }
                          placeholder="Right label"
                          className="w-24 rounded border border-[#CBD5E1] bg-white px-2 py-1 font-medium text-[#0F172A]"
                        />
                      </>
                    )}

                    <label className="inline-flex items-center gap-1.5 text-[#475569]">
                      <span>Card Headline:</span>
                      <input
                        type="text"
                        value={scene.graphicCard.headline}
                        onChange={(e) =>
                          onUpdateScene(
                            scene.id,
                            {
                              graphicCard: {
                                ...scene.graphicCard!,
                                headline: e.target.value,
                              },
                            },
                            false
                          )
                        }
                        className="w-44 rounded border border-[#CBD5E1] bg-white px-2 py-1 font-medium text-[#0F172A]"
                      />
                    </label>
                  </div>
                )}

                {/* Beat Visual Mode, Motion, Crop Region, Caption Zone, Kicker, Accent & SFX Controls */}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className="inline-flex items-center gap-1.5 text-xs text-[#475569]">
                    <span>Beat:</span>
                    <select
                      value={beatKind}
                      onChange={(e) => handleBeatKindChange(scene, e.target.value as BeatKind)}
                      className="rounded-md border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                    >
                      {(Object.keys(BEAT_KIND_LABELS) as BeatKind[]).map((bk) => (
                        <option key={bk} value={bk}>
                          {BEAT_KIND_LABELS[bk]}
                        </option>
                      ))}
                    </select>
                  </label>

                  {isCrop && (
                    <label className="inline-flex items-center gap-1.5 text-xs text-[#475569]">
                      <span>Crop:</span>
                      <select
                        value={scene.focalCrop ?? 'tight-macro'}
                        onChange={(e) =>
                          onUpdateScene(
                            scene.id,
                            { focalCrop: e.target.value as FocalCropRegion },
                            false
                          )
                        }
                        className="rounded-md border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                      >
                        {(Object.keys(FOCAL_CROP_LABELS) as FocalCropRegion[])
                          .filter((k) => k !== 'full')
                          .map((cropKey) => (
                            <option key={cropKey} value={cropKey}>
                              {FOCAL_CROP_LABELS[cropKey]}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}

                  {!isCard && (
                    <>
                      {media?.mediaType === 'video' ? (
                        <span className="text-xs text-[#475569]">
                          B-Roll Video · Auto-fitted
                        </span>
                      ) : (
                        <label className="inline-flex items-center gap-1.5 text-xs text-[#475569]">
                          <span>Motion:</span>
                          <select
                            value={scene.kenBurnsDirection}
                            onChange={(e) =>
                              onUpdateScene(
                                scene.id,
                                { kenBurnsDirection: e.target.value as KenBurnsDirection },
                                false
                              )
                            }
                            className="rounded-md border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                          >
                            {(Object.keys(DIRECTION_LABELS) as KenBurnsDirection[]).map((dir) => (
                              <option key={dir} value={dir}>
                                {DIRECTION_LABELS[dir]}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      <label className="inline-flex items-center gap-1.5 text-xs text-[#475569]">
                        <span>Zone:</span>
                        <select
                          value={scene.captionZone ?? 'top-banner'}
                          onChange={(e) =>
                            onUpdateScene(
                              scene.id,
                              { captionZone: e.target.value as CaptionZone },
                              false
                            )
                          }
                          className="rounded-md border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                        >
                          {(Object.keys(CAPTION_ZONE_LABELS) as CaptionZone[]).map((z) => (
                            <option key={z} value={z}>
                              {CAPTION_ZONE_LABELS[z]}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}

                  <label className="inline-flex items-center gap-1.5 text-xs text-[#475569]">
                    <span>Hold:</span>
                    <select
                      value={
                        scene.emotionalWeight >= 1.25
                          ? '1.35'
                          : scene.emotionalWeight <= 0.88
                            ? '0.8'
                            : '1.0'
                      }
                      onChange={(e) =>
                        onUpdateScene(
                          scene.id,
                          { emotionalWeight: Number(e.target.value) },
                          true
                        )
                      }
                      className="rounded-md border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                    >
                      <option value="0.8">Snap (0.8×)</option>
                      <option value="1.0">Balanced (1.0×)</option>
                      <option value="1.35">Hold (1.35×)</option>
                    </select>
                  </label>

                  <label className="inline-flex items-center gap-1.5 text-xs text-[#475569]">
                    <span>Kicker:</span>
                    <input
                      type="text"
                      value={scene.kicker ?? ''}
                      onChange={(e) =>
                        onUpdateScene(scene.id, { kicker: e.target.value }, false)
                      }
                      placeholder="BEAT 01"
                      className="w-24 rounded-md border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                    />
                  </label>

                  <label className="inline-flex items-center gap-1.5 text-xs text-[#475569]">
                    <span>Accent:</span>
                    <input
                      type="text"
                      value={scene.accentPhrase ?? ''}
                      onChange={(e) =>
                        onUpdateScene(scene.id, { accentPhrase: e.target.value }, false)
                      }
                      placeholder="in 8 days"
                      className="w-28 rounded-md border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                    />
                  </label>

                  <div className="inline-flex items-center gap-1.5 text-xs text-[#475569]">
                    <span>SFX:</span>
                    <select
                      value={scene.sfxCue ?? 'shutter'}
                      onChange={(e) =>
                        onUpdateScene(
                          scene.id,
                          { sfxCue: e.target.value as SfxCueType },
                          false
                        )
                      }
                      className="rounded-md border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                    >
                      {(Object.keys(SFX_LABELS) as SfxCueType[]).map((cueKey) => (
                        <option key={cueKey} value={cueKey}>
                          {SFX_LABELS[cueKey]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={!scene.sfxCue || scene.sfxCue === 'none'}
                      onClick={() => previewSfxCue(scene.sfxCue)}
                      title="Preview sound effect"
                      aria-label={`Preview SFX for beat ${scene.index + 1}`}
                      className="rounded-md border border-[#CBD5E1] bg-white p-1 text-[#475569] hover:text-[#2563EB] disabled:opacity-35"
                    >
                      <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
};
