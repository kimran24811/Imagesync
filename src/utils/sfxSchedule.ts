import type { SceneItem, SfxConfig, SfxCueType } from '../types/studio.ts';

export type ActiveSfxCue = Exclude<SfxCueType, 'none'>;

export interface ScheduledSfxEvent {
  id: string;
  cue: ActiveSfxCue;
  atMs: number;
}

export const ALL_ACTIVE_SFX_CUES: ActiveSfxCue[] = [
  'impact',
  'whoosh',
  'pop',
  'riser',
  'glitch',
  'chime',
  'typeclick',
  'thud',
  'shutter',
  'cashtick',
  'keyburst',
  'flashwhoosh',
];

export const DEFAULT_SFX_CONFIG: SfxConfig = {
  enabled: true,
  volumeDb: -5,
  includeTransitionWhoosh: true,
  includeTextPop: true,
  includeHookImpact: true,
  includeMicroBeatTicks: true,
};

export function inferDefaultSfxCue(
  text: string,
  sceneIndex: number,
  accentPhrase?: string,
  beatKind?: string
): SfxCueType {
  if (sceneIndex === 0) return 'impact';
  if (beatKind === 'graphic-card') {
    if (/\d/.test(text)) return 'cashtick';
    return sceneIndex % 2 === 0 ? 'flashwhoosh' : 'thud';
  }
  if (/\d/.test(text)) return 'cashtick';
  if (/[!?]/.test(text)) return 'thud';
  if (beatKind === 'crop-cut') return 'shutter';
  if (accentPhrase && accentPhrase.trim().length > 0 && sceneIndex % 4 === 2) {
    return 'keyburst';
  }
  const cycle: ActiveSfxCue[] = ['shutter', 'whoosh', 'pop', 'flashwhoosh', 'chime'];
  return cycle[sceneIndex % cycle.length];
}

/**
 * Shared dense SFX event scheduler used by BOTH React Preview AudioContext & FFmpeg Audio Mixer
 * so live playback matches the exported MP4 down to the millisecond.
 */
export function computeSfxSchedule(
  scenes: SceneItem[],
  config: SfxConfig,
  audioDurationMs: number
): ScheduledSfxEvent[] {
  if (!config.enabled || scenes.length === 0) return [];

  const events: ScheduledSfxEvent[] = [];
  const maxAtMs = Math.max(0, audioDurationMs - 80);

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (scene.motion) {
      for (const event of scene.motion.cues) {
        if(event.cue==='none') continue;
        const impact=event.cue==='impact'||event.cue==='thud';
        const transition=event.cue==='whoosh'||event.cue==='flashwhoosh';
        if(impact && i===0 && !config.includeHookImpact || transition && !config.includeTransitionWhoosh || !impact && !transition && !config.includeTextPop) continue;
        events.push({id:`${scene.id}_motion_${event.role}`,cue:event.cue,atMs:Math.max(0,Math.min(maxAtMs,event.atMs))});
      }
      continue;
    }
    const cue = scene.sfxCue;

    if (cue === 'none') continue;

    // A deep hook impact beneath the first visual cue adds energy without changing the VO.
    if (i === 0 && config.includeHookImpact && cue !== 'impact' && cue !== 'thud') {
      events.push({ id: `${scene.id}_hook_layer`, cue: 'impact', atMs: 0 });
    }

    // 1. Primary Beat Entry Cue
    if (cue === 'impact' || cue === 'thud') {
      if (i === 0 ? config.includeHookImpact : true) {
        events.push({
          id: `${scene.id}_${cue}`,
          cue,
          atMs: Math.min(maxAtMs, Math.max(0, scene.startMs)),
        });
      }
    } else if (cue === 'riser') {
      const leadMs = Math.min(540, Math.round(scene.durationMs * 0.45));
      events.push({
        id: `${scene.id}_riser`,
        cue: 'riser',
        atMs: Math.min(maxAtMs, Math.max(0, scene.startMs - leadMs)),
      });
    } else if (cue === 'whoosh' || cue === 'flashwhoosh') {
      if (config.includeTransitionWhoosh) {
        events.push({
          id: `${scene.id}_${cue}`,
          cue,
          atMs: Math.min(maxAtMs, Math.max(0, scene.startMs - 85)),
        });
      }
    } else if (
      cue === 'pop' ||
      cue === 'chime' ||
      cue === 'glitch' ||
      cue === 'typeclick' ||
      cue === 'shutter' ||
      cue === 'cashtick' ||
      cue === 'keyburst'
    ) {
      if (config.includeTextPop) {
        events.push({
          id: `${scene.id}_${cue}`,
          cue,
          atMs: Math.min(maxAtMs, Math.max(0, scene.startMs + (cue === 'shutter' ? 0 : 40))),
        });
      }
    } else {
      if (i === 0 && config.includeHookImpact) {
        events.push({ id: `${scene.id}_impact`, cue: 'impact', atMs: 0 });
      } else if (i > 0 && config.includeTransitionWhoosh) {
        events.push({
          id: `${scene.id}_cut_cue`,
          cue: scene.beatKind === 'crop-cut' ? 'shutter' : 'whoosh',
          atMs: Math.max(0, scene.startMs - (scene.beatKind === 'crop-cut' ? 0 : 85)),
        });
      }
    }

    // 2. Subtle Camera Shutter / Whip Cut Layer on rapid beat switches when primary cue is graphic/text
    if (
      i > 0 &&
      config.includeTransitionWhoosh &&
      (cue === 'pop' || cue === 'chime' || cue === 'keyburst' || cue === 'cashtick')
    ) {
      events.push({
        id: `${scene.id}_cutsnap`,
        cue: scene.beatKind === 'graphic-card' ? 'flashwhoosh' : 'shutter',
        atMs: Math.max(0, scene.startMs - 55),
      });
    }

    // 3. Dense Micro-Beat Sub-Ticks & Payoff Chimes inside scenes (typing, stat rolls, word bursts)
    if (config.includeMicroBeatTicks && scene.durationMs >= (scene.beatKind === 'graphic-card' ? 950 : 1450)) {
      const midAt = Math.round(scene.startMs + scene.durationMs * 0.48);
      if (midAt < maxAtMs - 110) {
        let midCue: ActiveSfxCue = 'typeclick';
        if (scene.graphicCard?.cardType === 'stat-counter' || /\d/.test(scene.text)) {
          midCue = 'chime';
        } else if (scene.durationMs >= 2200) {
          midCue = scene.index % 2 === 0 ? 'keyburst' : 'pop';
        }
        events.push({
          id: `${scene.id}_mid`,
          cue: midCue,
          atMs: midAt,
        });
      }
    }
  }

  // Layer a deep hit with a detail accent, never an uncontrolled pile-up.
  const sorted = events.sort((a, b) => a.atMs - b.atMs);
  const filtered: ScheduledSfxEvent[] = [];
  const lastCueAt = new Map<ActiveSfxCue, number>();
  const lastLaneAt = new Map<string, number>();
  for (const ev of sorted) {
    const lane = ev.cue === 'impact' || ev.cue === 'thud' ? 'impact'
      : ev.cue === 'whoosh' || ev.cue === 'flashwhoosh' || ev.cue === 'shutter'
        ? 'transition' : 'detail';
    if (ev.atMs - (lastCueAt.get(ev.cue) ?? -Infinity) < (scenes.some(s=>s.motion)?320:125)) continue;
    if (ev.atMs - (lastLaneAt.get(lane) ?? -Infinity) < 60) continue;
    if (filtered.filter((other) => Math.abs(other.atMs - ev.atMs) < 65).length >= 2) continue;
    if (filtered.filter((other) => ev.atMs - other.atMs < 1000).length >= (scenes.some(s=>s.motion)?3:9)) continue;
    filtered.push(ev);
    lastCueAt.set(ev.cue, ev.atMs);
    lastLaneAt.set(lane, ev.atMs);
    if (filtered.length >= 160) break;
  }
  return filtered;
}
