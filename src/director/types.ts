import type { KenBurnsDirection, SceneItem, SfxCueType } from '../types/studio.ts';

export type DirectorPresetId =
  'editorial-motion' | 'rapid-viral' | 'cinematic-story' | 'educational' | 'cartoon-energy';
export type MotionLayout = 'headline' | 'stat' | 'callout' | 'chapter' | 'list' | 'minimal';
export type Entrance = 'rise' | 'pop' | 'slide' | 'wipe' | 'blur' | 'typewriter' | 'tracking';
export type MotionTransition =
  | 'cut'
  | 'fade'
  | 'dissolve'
  | 'fadeblack'
  | 'fadewhite'
  | 'wipeleft'
  | 'wiperight'
  | 'wipeup'
  | 'wipedown'
  | 'slideleft'
  | 'slideright'
  | 'slideup'
  | 'slidedown'
  | 'smoothleft'
  | 'smoothright'
  | 'smoothup'
  | 'smoothdown'
  | 'circleopen'
  | 'circleclose'
  | 'radial'
  | 'pixelize'
  | 'hblur'
  | 'zoomin'
  | 'squeezeh'
  | 'squeezev'
  | 'diagtl'
  | 'diagbr';
export const MOTION_TRANSITIONS: MotionTransition[] = [
  'cut',
  'fade',
  'dissolve',
  'fadeblack',
  'fadewhite',
  'wipeleft',
  'wiperight',
  'wipeup',
  'wipedown',
  'slideleft',
  'slideright',
  'slideup',
  'slidedown',
  'smoothleft',
  'smoothright',
  'smoothup',
  'smoothdown',
  'circleopen',
  'circleclose',
  'radial',
  'pixelize',
  'hblur',
  'zoomin',
  'squeezeh',
  'squeezev',
  'diagtl',
  'diagbr',
];
export const LAYOUTS: MotionLayout[] = [
  'headline',
  'stat',
  'callout',
  'chapter',
  'list',
  'minimal',
];
export const ENTRANCES: Entrance[] = [
  'rise',
  'pop',
  'slide',
  'wipe',
  'blur',
  'typewriter',
  'tracking',
];
export interface TimedWord {
  text: string;
  startMs: number;
  endMs: number;
  source: 'speech' | 'inferred';
}
export interface SpeechAlignment {
  engine: 'faster-whisper' | 'estimated';
  coverage: number;
  words: TimedWord[];
  notice?: string;
}
export interface MotionCue {
  atMs: number;
  cue: SfxCueType;
  role: 'entrance' | 'emphasis' | 'transition';
}
export interface MotionDesign {
  version: 1;
  originMs?: number;
  secondaryText?: string;
  secondaryAtMs?: number;
  preset: DirectorPresetId;
  layout: MotionLayout;
  entrance: Entrance;
  headline: string;
  accent: string;
  icon: 'money' | 'clock' | 'idea' | 'growth' | 'question' | 'arrow' | 'none';
  transition: MotionTransition;
  transitionMs: number;
  cues: MotionCue[];
  quiet: boolean;
  reason: string;
}
export interface DirectorSettings {
  enabled: boolean;
  preset: DirectorPresetId;
  alignment: 'auto' | 'required' | 'estimated';
  music?: 'auto' | 'none';
}
export interface DirectorReport {
  version: 1;
  preset: DirectorPresetId;
  engine: 'rules-v1' | 'gemini-assisted';
  alignment: Omit<SpeechAlignment, 'words'>;
  notices: string[];
  effectCount: number;
}
export interface DirectorPreset {
  id: DirectorPresetId;
  name: string;
  description: string;
  accent: string;
  background: string;
  rhythm: number;
  camera: KenBurnsDirection[];
}
export const DIRECTOR_PRESETS: DirectorPreset[] = [
  {
    id: 'editorial-motion',
    name: 'Editorial Motion',
    description: 'Reference-inspired bold type, pink accents, cream cards and purposeful reveals.',
    accent: '#ff3d87',
    background: '#101015',
    rhythm: 3,
    camera: ['zoom-in', 'pan-right', 'zoom-out', 'pan-left'],
  },
  {
    id: 'rapid-viral',
    name: 'Rapid Viral',
    description: 'Fast concept cuts, large keywords, punch-ins and selective impact accents.',
    accent: '#caff49',
    background: '#111712',
    rhythm: 2,
    camera: ['snap-zoom-in', 'pan-left', 'whip-zoom', 'zoom-out'],
  },
  {
    id: 'cinematic-story',
    name: 'Cinematic Storytelling',
    description: 'Restrained typography, slow framing, soft transitions and quiet moments.',
    accent: '#dfbb7b',
    background: '#111216',
    rhythm: 5,
    camera: ['zoom-in', 'pan-right', 'zoom-out', 'pan-up'],
  },
  {
    id: 'educational',
    name: 'Educational Explainer',
    description: 'Clear cream panels, highlighted concepts, step cards and calm sound design.',
    accent: '#5c55e7',
    background: '#f4efe5',
    rhythm: 4,
    camera: ['zoom-in', 'pan-right', 'zoom-out', 'pan-left'],
  },
  {
    id: 'cartoon-energy',
    name: 'High-Energy Cartoon',
    description: 'Springy type, outlined callouts, bright shapes and playful accents.',
    accent: '#ffca3a',
    background: '#14233b',
    rhythm: 3,
    camera: ['snap-zoom-in', 'pan-right', 'impact-shake', 'zoom-out'],
  },
];
export const DEFAULT_DIRECTOR: DirectorSettings = {
  enabled: true,
  preset: 'editorial-motion',
  alignment: 'auto',
  music: 'auto',
};
export function sanitizeDirector(raw: unknown): DirectorSettings {
  const x = raw && typeof raw === 'object' ? (raw as Partial<DirectorSettings>) : {};
  return {
    music: x.music === 'none' ? 'none' : 'auto',
    enabled: x.enabled !== false,
    preset: DIRECTOR_PRESETS.some((p) => p.id === x.preset) ? x.preset! : 'editorial-motion',
    alignment: x.alignment === 'required' || x.alignment === 'estimated' ? x.alignment : 'auto',
  };
}
export interface PlannedScene extends SceneItem {
  motion?: MotionDesign;
  words?: TimedWord[];
}
