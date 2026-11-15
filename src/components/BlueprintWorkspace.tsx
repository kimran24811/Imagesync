import React, { useState } from 'react';
import {
  ArrowRight,
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  Mic,
  Palette,
  Sparkles,
  Volume2,
} from 'lucide-react';
import type {
  ArtStylePresetId,
  AspectRatio,
  StoryBlueprint,
  TtsVoiceName,
} from '../types/studio';
import { downloadSmallFileViaFetch } from '../utils/download';

interface ArtStyleOption {
  id: ArtStylePresetId;
  categoryLabel: string;
  label: string;
  tagline: string;
  swatches: [string, string, string];
}

const STYLE_OPTIONS: ArtStyleOption[] = [
  {
    id: 'saveo-ink',
    categoryLabel: 'Character Explainer',
    label: 'Saveo Dark Ink Character',
    tagline: 'Minimalist round-head character in dark hoodie, crisp ink lines & selective coral rim light',
    swatches: ['#18181B', '#E4E4E7', '#F43F5E'],
  },
  {
    id: 'stick-figure',
    categoryLabel: 'Stick Art',
    label: 'Stick Art / Kinetic Chalkboard',
    tagline: 'Expressive minimalist stick-figure storytelling on matte dark slate with cyan & coral highlights',
    swatches: ['#09090B', '#F8FAFC', '#38BDF8'],
  },
  {
    id: 'whiteboard-sketch',
    categoryLabel: 'Whiteboard Explainer',
    label: 'Whiteboard Marker Sketch',
    tagline: 'Clean black dry-erase marker drawings on crisp paper with blue & coral highlights',
    swatches: ['#FFFFFF', '#0F172A', '#2563EB'],
  },
  {
    id: 'noir-gold',
    categoryLabel: 'Finance & History',
    label: 'Noir Monochrome + Gold',
    tagline: 'High-contrast charcoal ink noir with glowing molten gold highlights (Gold Rush style)',
    swatches: ['#0B0F19', '#94A3B8', '#F59E0B'],
  },
  {
    id: 'documentary-35mm',
    categoryLabel: 'Documentary Film',
    label: 'Documentary 35mm Cinema',
    tagline: 'Moody 35mm photorealistic shadows, tungsten desk lamps, subtle film grain',
    swatches: ['#0F172A', '#38BDF8', '#FDBA74'],
  },
  {
    id: 'editorial-cream',
    categoryLabel: 'Editorial Infographics',
    label: 'Editorial Cream Poster',
    tagline: 'Warm cream paper card aesthetic with crisp charcoal ink & selective coral highlights',
    swatches: ['#F5F0E6', '#1E293B', '#F43F5E'],
  },
  {
    id: 'midnight-crimson',
    categoryLabel: 'Horror & Mystery',
    label: 'Midnight Thriller & Mystery',
    tagline: 'Eerie foggy silhouettes, cold silver moonlight & tense crimson accents',
    swatches: ['#09090B', '#475569', '#DC2626'],
  },
  {
    id: 'stylized-3d',
    categoryLabel: '3D Animation',
    label: 'Stylized 3D Matte Diorama',
    tagline: 'Tactile miniature matte 3D character & studio lighting with shallow depth of field',
    swatches: ['#1E1B4B', '#A5B4FC', '#F472B6'],
  },
  {
    id: 'custom',
    categoryLabel: 'Custom Style',
    label: 'Custom Style Anchor',
    tagline: 'Define your own visual rules, wardrobe, and color palette locked across every shot',
    swatches: ['#1E293B', '#64748B', '#10B981'],
  },
];

const TTS_VOICES: Array<{ id: TtsVoiceName; label: string; tone: string }> = [
  { id: 'Charon', label: 'Charon', tone: 'Deep Documentary' },
  { id: 'Fenrir', label: 'Fenrir', tone: 'Bold & Dramatic' },
  { id: 'Puck', label: 'Puck', tone: 'Fast Explainer' },
  { id: 'Kore', label: 'Kore', tone: 'Clear Narrator' },
  { id: 'Zephyr', label: 'Zephyr', tone: 'Warm Storyteller' },
];

export interface BlueprintTransferPayload {
  blueprint: StoryBlueprint;
  generatedAudioUrl?: string;
  generatedAudioFilename?: string;
}

interface BlueprintWorkspaceProps {
  aspectRatio: AspectRatio;
  onChangeAspectRatio: (ratio: AspectRatio) => void;
  geminiConfigured: boolean;
  onSendToAssembler: (payload: BlueprintTransferPayload) => void;
}

export const BlueprintWorkspace: React.FC<BlueprintWorkspaceProps> = ({
  aspectRatio,
  onChangeAspectRatio,
  geminiConfigured,
  onSendToAssembler,
}) => {
  const [topic, setTopic] = useState('');
  const [language, setLanguage] = useState('English');
  const [sceneCountMode, setSceneCountMode] = useState<'auto' | 'custom'>('auto');
  const [customSceneCount, setCustomSceneCount] = useState(20);
  const [artStyleId, setArtStyleId] = useState<ArtStylePresetId>('saveo-ink');
  const [customStyleNote, setCustomStyleNote] = useState('');

  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [blueprint, setBlueprint] = useState<StoryBlueprint | null>(null);

  const [includeContinuity, setIncludeContinuity] = useState(true);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Free-tier Gemini TTS state
  const [ttsVoice, setTtsVoice] = useState<TtsVoiceName>('Charon');
  const [ttsStyle, setTtsStyle] = useState(
    'Deep, captivating short-form documentary narrator, crisp pauses on key numbers'
  );
  const [isGeneratingTts, setIsGeneratingTts] = useState(false);
  const [ttsResult, setTtsResult] = useState<{
    url: string;
    filename: string;
    durationMs: number;
  } | null>(null);

  const copyText = (key: string, value: string) => {
    navigator.clipboard.writeText(value).catch(() => {});
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1800);
  };

  const handleGenerateBlueprint = async () => {
    if (!topic.trim()) {
      setErrorMsg('Please enter a topic or story idea to build your prompt pack.');
      return;
    }

    setErrorMsg(null);
    setIsGenerating(true);
    setTtsResult(null);

    try {
      const res = await fetch('/api/blueprint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topic,
          language,
          sceneCount: sceneCountMode === 'auto' ? 'auto' : customSceneCount,
          aspectRatio,
          artStyleId,
          customStyleNote,
        }),
      });
      const data = (await res.json()) as StoryBlueprint & { error?: string };
      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate story blueprint.');
      }
      setBlueprint(data);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Blueprint generation failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateVoiceover = async () => {
    if (!blueprint?.fullScript.trim()) return;
    setErrorMsg(null);
    setIsGeneratingTts(true);

    try {
      const res = await fetch('/api/blueprint/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script: blueprint.fullScript,
          voiceName: ttsVoice,
          deliveryStyle: ttsStyle,
        }),
      });
      const data = (await res.json()) as {
        url?: string;
        filename?: string;
        durationMs?: number;
        error?: string;
      };
      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Voiceover generation failed.');
      }
      setTtsResult({
        url: data.url,
        filename: data.filename || 'narrator.wav',
        durationMs: data.durationMs || 0,
      });
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Voiceover generation failed.');
    } finally {
      setIsGeneratingTts(false);
    }
  };

  const buildPromptPackText = (bp: StoryBlueprint): string => {
    const lines: string[] = [
      `SCENESYNC STUDIO — STYLE-LOCKED STORY BLUEPRINT ($0 WORKFLOW)`,
      `Topic: ${bp.topic}`,
      `Category: ${bp.categoryLabel} | Style: ${bp.artStyleLabel} | Language: ${bp.language}`,
      ``,
      `=== MASTER CHARACTER ANCHOR ("One character, every shot") ===`,
      bp.characterAnchor,
      ``,
      `=== MASTER ART STYLE ANCHOR ===`,
      bp.masterStyleAnchor,
      ``,
      `=== CHATBOT REFERENCE CONTINUITY PREFIX (Use on Shots 2+) ===`,
      bp.continuityPrefix,
      ``,
      `=== FULL VOICEOVER SCRIPT ===`,
      bp.fullScript,
      ``,
      `=== SCENE PROMPTS ===`,
    ];

    for (const s of bp.scenes) {
      if (s.beatKind === 'graphic-card') {
        lines.push(
          `\n[Beat ${String(s.index + 1).padStart(2, '0')} · ${s.title} · $0 AUTO GRAPHIC CARD]`,
          `Kicker: ${s.kicker} | Accent Text: ${s.accentPhrase} | SFX: ${s.sfxCue}`,
          `Spoken Line: ${s.spokenLine}`,
          `Auto Card: ${s.graphicCard?.cardType ?? 'statement'} — ${s.graphicCard?.statValue ? `${s.graphicCard.statValue} ` : ''}${s.graphicCard?.headline ?? s.spokenLine} (No image needed!)`
        );
        continue;
      }

      const fullPrompt =
        includeContinuity && s.index > 0
          ? `${bp.continuityPrefix} ${s.imagePrompt}`
          : s.imagePrompt;
      lines.push(
        `\n[Beat ${String(s.index + 1).padStart(2, '0')} · ${s.title}]`,
        `Kicker: ${s.kicker} | Accent Text: ${s.accentPhrase} | SFX: ${s.sfxCue}`,
        `Spoken Line: ${s.spokenLine}`,
        `Image Prompt:\n${fullPrompt}`
      );
    }

    return lines.join('\n');
  };

  const handleDownloadPack = () => {
    if (!blueprint) return;
    const content = buildPromptPackText(blueprint);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scenesync_blueprint_${blueprint.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div
          role="alert"
          className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-4 py-3 text-sm text-[#991B1B]"
        >
          {errorMsg}
        </div>
      )}

      {/* Step 1: Topic + Style Lock Controls */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 lg:col-span-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="text-base font-semibold text-[#0F172A]">
              01. Story Topic & Structure
            </h2>
            <span className="text-xs font-medium text-[#16A34A]">$0 Prompt Pack</span>
          </div>

          <div className="space-y-4">
            <div>
              <label
                htmlFor="bp-topic"
                className="block text-xs font-medium text-[#475569]"
              >
                Video Topic / Hook Idea
              </label>
              <textarea
                id="bp-topic"
                rows={4}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="e.g. How one solo creator grew to 200,000 followers in 8 days using only one laptop and consistent character art..."
                className="mt-1.5 w-full resize-none rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] p-3 text-sm text-[#0F172A] placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:bg-white focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="bp-language"
                  className="block text-xs font-medium text-[#475569]"
                >
                  Language
                </label>
                <select
                  id="bp-language"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-[#CBD5E1] bg-white px-2.5 py-2 text-xs font-medium text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                >
                  <option value="English">English</option>
                  <option value="Roman Urdu">Roman Urdu</option>
                  <option value="Urdu">Urdu</option>
                  <option value="Hindi">Hindi</option>
                  <option value="Spanish">Spanish</option>
                  <option value="Arabic">Arabic</option>
                </select>
              </div>

              <div>
                <span className="block text-xs font-medium text-[#475569]">Format</span>
                <div className="mt-1.5 inline-flex w-full rounded-lg bg-[#F1F5F9] p-1">
                  <button
                    type="button"
                    onClick={() => onChangeAspectRatio('9:16')}
                    className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                      aspectRatio === '9:16'
                        ? 'bg-white text-[#0F172A] shadow-xs'
                        : 'text-[#475569]'
                    }`}
                  >
                    9:16
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeAspectRatio('16:9')}
                    className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                      aspectRatio === '16:9'
                        ? 'bg-white text-[#0F172A] shadow-xs'
                        : 'text-[#475569]'
                    }`}
                  >
                    16:9
                  </button>
                </div>
              </div>
            </div>

            {/* Flexible Scene & Prompt Count (Auto or up to 60 scenes) */}
            <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-[#0F172A]">
                  Number of Scene Prompts
                </span>
                <div className="inline-flex rounded-md bg-[#E2E8F0]/70 p-0.5">
                  <button
                    type="button"
                    onClick={() => setSceneCountMode('auto')}
                    className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      sceneCountMode === 'auto'
                        ? 'bg-white text-[#0F172A] shadow-xs'
                        : 'text-[#475569] hover:text-[#0F172A]'
                    }`}
                  >
                    Auto Pace
                  </button>
                  <button
                    type="button"
                    onClick={() => setSceneCountMode('custom')}
                    className={`rounded px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                      sceneCountMode === 'custom'
                        ? 'bg-white text-[#0F172A] shadow-xs'
                        : 'text-[#475569] hover:text-[#0F172A]'
                    }`}
                  >
                    Custom (3–60)
                  </button>
                </div>
              </div>

              {sceneCountMode === 'auto' ? (
                <p className="mt-2 text-[11px] leading-relaxed text-[#64748B]">
                  Generates 16–24 rapid concept micro-beats (~1–1.5s/cut), mixing AI image prompts with $0 animated stat/statement cards.
                </p>
              ) : (
                <div className="mt-2.5 space-y-2">
                  <div className="flex items-center gap-3">
                    <input
                      id="bp-scenes"
                      type="range"
                      min={4}
                      max={60}
                      step={1}
                      value={customSceneCount}
                      onChange={(e) => setCustomSceneCount(Number(e.target.value))}
                      className="h-1.5 flex-1 accent-[#2563EB]"
                    />
                    <input
                      type="number"
                      min={4}
                      max={60}
                      value={customSceneCount}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val)) {
                          setCustomSceneCount(Math.max(4, Math.min(60, Math.round(val))));
                        }
                      }}
                      aria-label="Custom number of beats"
                      className="tabular-time w-16 rounded-md border border-[#CBD5E1] bg-white px-2 py-1 text-center text-xs font-semibold text-[#0F172A] focus:border-[#2563EB] focus:outline-none"
                    />
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[12, 20, 30, 45].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setCustomSceneCount(preset)}
                        className={`rounded border px-2 py-0.5 text-[11px] font-medium tabular-time transition-colors ${
                          customSceneCount === preset
                            ? 'border-[#2563EB] bg-[#EFF6FF] text-[#1D4ED8]'
                            : 'border-[#CBD5E1] bg-white text-[#475569] hover:text-[#0F172A]'
                        }`}
                      >
                        {preset} beats
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-xl border border-[#E2E8F0] bg-white p-5 lg:col-span-7">
          <div>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Palette className="h-4 w-4 text-[#2563EB]" aria-hidden="true" />
                <h2 className="text-base font-semibold text-[#0F172A]">
                  02. Video Category & Locked Art Style
                </h2>
              </div>
              <span className="text-xs text-[#64748B]">8 Categories + Custom</span>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
              {STYLE_OPTIONS.map((style) => {
                const selected = artStyleId === style.id;
                return (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setArtStyleId(style.id)}
                    className={`flex items-start gap-2.5 rounded-lg border p-2.5 text-left transition-colors ${
                      selected
                        ? 'border-[#2563EB] bg-[#EFF6FF]/65'
                        : 'border-[#E2E8F0] bg-[#F8FAFC] hover:border-[#CBD5E1]'
                    }`}
                  >
                    <div className="mt-0.5 flex shrink-0 -space-x-1">
                      {style.swatches.map((hex) => (
                        <span
                          key={hex}
                          style={{ backgroundColor: hex }}
                          className="h-3.5 w-3.5 rounded-full border border-white shadow-xs"
                        />
                      ))}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#2563EB]">
                        {style.categoryLabel}
                      </p>
                      <p className="mt-0.5 text-xs font-semibold text-[#0F172A] leading-tight">
                        {style.label}
                      </p>
                      <p className="mt-1 text-[11px] leading-snug text-[#475569] line-clamp-2">
                        {style.tagline}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>

            {artStyleId === 'custom' && (
              <div className="mt-3">
                <input
                  type="text"
                  value={customStyleNote}
                  onChange={(e) => setCustomStyleNote(e.target.value)}
                  placeholder="Describe your locked character, clothing, ink line style, and lighting colors..."
                  className="w-full rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2 text-xs text-[#0F172A] focus:border-[#2563EB] focus:bg-white focus:outline-none"
                />
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] pt-4">
            <p className="text-xs text-[#475569]">
              Generates your script, character Bible, and{' '}
              {sceneCountMode === 'auto'
                ? 'auto-paced'
                : `${customSceneCount}`}{' '}
              locked scene prompts for any AI image tool.
            </p>
            <button
              type="button"
              disabled={isGenerating || !topic.trim()}
              onClick={handleGenerateBlueprint}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0F172A] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#1E293B] disabled:cursor-not-allowed disabled:bg-[#94A3B8] whitespace-nowrap"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  <span>Generating Blueprint...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  <span>Generate Style-Locked Blueprint</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Step 2: Generated Blueprint Output */}
      {blueprint && (
        <div className="space-y-6">
          {blueprint.fallbackNotice && (
            <div className="rounded-lg border border-[#FDE68A] bg-[#FFFBEB] px-4 py-2.5 text-xs text-[#92400E]">
              {blueprint.fallbackNotice}
            </div>
          )}

          {/* Character & Style Anchor + Script + Optional Free TTS */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
            <div className="rounded-xl border border-[#E2E8F0] bg-white p-5 lg:col-span-5">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-[#0F172A]">
                  Master Character & Style Lock
                </h3>
                <button
                  type="button"
                  onClick={() =>
                    copyText(
                      'anchors',
                      `${blueprint.characterAnchor}\n\n${blueprint.masterStyleAnchor}`
                    )
                  }
                  className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 text-xs font-medium text-[#0F172A] hover:bg-[#F1F5F9]"
                >
                  {copiedKey === 'anchors' ? (
                    <>
                      <Check className="h-3.5 w-3.5 text-[#16A34A]" aria-hidden="true" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Copy Lock</span>
                    </>
                  )}
                </button>
              </div>

              <div className="space-y-3 text-xs">
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <p className="font-semibold text-[#0F172A]">Character DNA</p>
                  <p className="mt-1 leading-relaxed text-[#475569]">
                    {blueprint.characterAnchor}
                  </p>
                </div>
                <div className="rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3">
                  <p className="font-semibold text-[#0F172A]">Visual & Lighting Lock</p>
                  <p className="mt-1 leading-relaxed text-[#475569]">
                    {blueprint.masterStyleAnchor}
                  </p>
                </div>
                <div className="rounded-lg border border-[#DBEAFE] bg-[#EFF6FF]/60 p-3">
                  <p className="font-semibold text-[#1E3A8A]">
                    Tip for 100% Character Consistency
                  </p>
                  <p className="mt-1 leading-relaxed text-[#1E40AF]">
                    Generate Scene 1 first. Then attach Scene 1&apos;s image as a reference in your chatbot when pasting prompts 2–{blueprint.scenes.length}.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-col justify-between rounded-xl border border-[#E2E8F0] bg-white p-5 lg:col-span-7">
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-[#2563EB]" aria-hidden="true" />
                    <h3 className="text-sm font-semibold text-[#0F172A]">
                      Full Voiceover Script ({blueprint.language})
                    </h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => copyText('script', blueprint.fullScript)}
                      className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 text-xs font-medium text-[#0F172A] hover:bg-[#F1F5F9]"
                    >
                      {copiedKey === 'script' ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-[#16A34A]" aria-hidden="true" />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Copy Script</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadPack}
                      className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1 text-xs font-medium text-[#0F172A] hover:bg-[#F1F5F9]"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>Download .txt Pack</span>
                    </button>
                  </div>
                </div>

                <textarea
                  value={blueprint.fullScript}
                  onChange={(e) =>
                    setBlueprint((prev) =>
                      prev ? { ...prev, fullScript: e.target.value } : prev
                    )
                  }
                  rows={4}
                  className="w-full resize-none rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3 text-sm leading-relaxed text-[#0F172A] focus:border-[#2563EB] focus:bg-white focus:outline-none"
                />

                {/* Optional Free-Tier Gemini TTS Voiceover */}
                <div className="mt-4 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-3.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <Mic className="h-4 w-4 text-[#2563EB]" aria-hidden="true" />
                      <span className="text-xs font-semibold text-[#0F172A]">
                        Optional: Generate Free Gemini Voiceover WAV
                      </span>
                    </div>
                    <span className="text-[11px] text-[#64748B]">
                      {geminiConfigured ? 'gemini-3.8-flash-lite-tts' : 'Requires GEMINI_API_KEY (or record locally)'}
                    </span>
                  </div>

                  <div className="mt-2.5 grid grid-cols-1 gap-2.5 sm:grid-cols-12">
                    <select
                      value={ttsVoice}
                      onChange={(e) => setTtsVoice(e.target.value as TtsVoiceName)}
                      aria-label="Narrator voice"
                      className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] sm:col-span-4"
                    >
                      {TTS_VOICES.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.label} ({v.tone})
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={ttsStyle}
                      onChange={(e) => setTtsStyle(e.target.value)}
                      placeholder="Voice delivery style..."
                      className="rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs text-[#0F172A] sm:col-span-5"
                    />
                    <button
                      type="button"
                      disabled={isGeneratingTts || !geminiConfigured}
                      onClick={handleGenerateVoiceover}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md bg-[#2563EB] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:bg-[#94A3B8] sm:col-span-3 whitespace-nowrap"
                    >
                      {isGeneratingTts ? (
                        <>
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                          <span>Voicing...</span>
                        </>
                      ) : (
                        <>
                          <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>Generate WAV</span>
                        </>
                      )}
                    </button>
                  </div>

                  {ttsResult && (
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E8F0] pt-2.5">
                      <audio controls src={ttsResult.url} className="h-8 max-w-full flex-1" />
                      <button
                        type="button"
                        onClick={() => {
                          void downloadSmallFileViaFetch(ttsResult.url, ttsResult.filename).catch(
                            (err: unknown) =>
                              setErrorMsg(
                                err instanceof Error ? err.message : 'WAV download failed.'
                              )
                          );
                        }}
                        className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2.5 py-1.5 text-xs font-medium text-[#0F172A] hover:bg-[#F1F5F9]"
                      >
                        <Download className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>Download WAV</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-end gap-3 border-t border-[#E2E8F0] pt-4">
                <button
                  type="button"
                  onClick={() =>
                    onSendToAssembler({
                      blueprint,
                      generatedAudioUrl: ttsResult?.url,
                      generatedAudioFilename: ttsResult?.filename,
                    })
                  }
                  className="inline-flex items-center gap-2 rounded-lg bg-[#2563EB] px-4 py-2 text-xs font-semibold text-white hover:bg-[#1D4ED8] whitespace-nowrap"
                >
                  <span>
                    {ttsResult
                      ? 'Send Script + Generated WAV & Cues to Assembler'
                      : 'Send Script & Typography Cues to Assembler'}
                  </span>
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          {/* Per-Scene Prompt Cards */}
          <div className="rounded-xl border border-[#E2E8F0] bg-white p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-b border-[#E2E8F0] pb-4">
              <div>
                <h3 className="text-base font-semibold text-[#0F172A]">
                  Scene-by-Scene Image Prompts & Explainer Cues
                </h3>
                <p className="mt-0.5 text-xs text-[#475569]">
                  Paste each prompt into your AI image tool in order, then drop the generated images into Tab 1 to assemble the 1080p video.
                </p>
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-medium text-[#0F172A] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeContinuity}
                  onChange={(e) => setIncludeContinuity(e.target.checked)}
                  className="rounded border-[#CBD5E1] accent-[#2563EB]"
                />
                <span>Prepend Reference-Image Continuity on Shots 2+</span>
              </label>
            </div>

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {blueprint.scenes.map((scene) => {
                const isCardBeat = scene.beatKind === 'graphic-card';
                const effectivePrompt =
                  includeContinuity && scene.index > 0
                    ? `${blueprint.continuityPrefix} ${scene.imagePrompt}`
                    : scene.imagePrompt;
                const copyKey = `scene_${scene.index}`;

                return (
                  <div
                    key={scene.index}
                    className="flex flex-col justify-between rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] p-4"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex flex-wrap items-center gap-1.5 text-[#475569]">
                          <span className="font-semibold text-[#0F172A] tabular-time">
                            Beat {String(scene.index + 1).padStart(2, '0')}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-medium text-[#2563EB]">
                            {isCardBeat ? '$0 Auto Graphic Card' : scene.kicker}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>SFX: {scene.sfxCue}</span>
                        </div>
                        {!isCardBeat && (
                          <button
                            type="button"
                            onClick={() => copyText(copyKey, effectivePrompt)}
                            className="inline-flex items-center gap-1 rounded-md border border-[#CBD5E1] bg-white px-2 py-1 text-xs font-medium text-[#0F172A] hover:bg-[#F1F5F9] whitespace-nowrap shrink-0"
                          >
                            {copiedKey === copyKey ? (
                              <>
                                <Check className="h-3 w-3 text-[#16A34A]" aria-hidden="true" />
                                <span>Copied</span>
                              </>
                            ) : (
                              <>
                                <Copy className="h-3 w-3" aria-hidden="true" />
                                <span>Copy Prompt</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>

                      <p className="mt-2 text-xs font-medium text-[#0F172A]">
                        &ldquo;{scene.spokenLine}&rdquo;
                      </p>
                      {scene.accentPhrase && (
                        <p className="mt-1 text-[11px] text-[#64748B]">
                          Kinetic Accent: <span className="font-semibold text-[#F43F5E]">{scene.accentPhrase}</span>
                        </p>
                      )}

                      {isCardBeat ? (
                        <div className="mt-2.5 rounded-md border border-[#CBD5E1] bg-[#0F172A] p-3 text-xs text-white">
                          <p className="font-mono text-[10px] font-bold uppercase tracking-wider text-[#F43F5E]">
                            Auto-Rendered Vector Card · No Image Needed
                          </p>
                          <p className="mt-1 font-semibold tabular-time">
                            {scene.graphicCard?.statValue
                              ? `${scene.graphicCard.statValue} ${scene.graphicCard.statUnit ?? ''} — `
                              : ''}
                            {scene.graphicCard?.headline || scene.spokenLine}
                          </p>
                        </div>
                      ) : (
                        <div className="mt-2.5 rounded-md border border-[#E2E8F0] bg-white p-2.5 text-xs leading-relaxed text-[#334155]">
                          {effectivePrompt}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
