import type { SceneItem, TransitionStyle } from '../types/studio.ts';

/** Frame-exact transitions. Snap cuts have zero overlap. */
export interface DirectorBoundary {
  kind: 'snap' | 'whip' | 'flash' | 'dissolve';
  transition: string;
  overlapFrames: number;
}

const RHYTHMIC_WHIPS = ['slideleft', 'smoothright', 'slideup', 'smoothleft'] as const;

export function planDirectorTransitions(
  scenes: SceneItem[],
  frameCounts: number[],
  style: TransitionStyle,
  requestedDurationMs = 280,
  fps = 30
): DirectorBoundary[] {
  if (scenes.length !== frameCounts.length) {
    throw new Error('Transition planner received mismatched scenes and frame counts.');
  }
  if (!Number.isFinite(fps) || fps <= 0) {
    throw new Error('Transition planner requires a positive frame rate.');
  }
  if (style === 'cut' || scenes.length < 2) return [];

  const boundaries: DirectorBoundary[] = [];
  for (let i = 0; i < scenes.length - 1; i++) {
    const next = scenes[i + 1];
    let kind: DirectorBoundary['kind'] = 'snap';
    let transition = 'fade';
    let desiredFrames = 0;

    if (style === 'crossfade') {
      kind = 'dissolve';
      desiredFrames = Math.max(3, Math.min(14, Math.round(requestedDurationMs * fps / 1000)));
    } else {
      const isCard = next.beatKind === 'graphic-card';
      const isImpact = next.emotionalWeight >= 1.25 ||
        next.sfxCue === 'impact' || next.sfxCue === 'flashwhoosh' ||
        next.sfxCue === 'thud';
      const isRhythmicAccent = (i + 1) % 4 === 0 && next.beatKind !== 'crop-cut';

      if (isCard || isImpact) {
        kind = 'flash';
        transition = isCard && next.graphicCard?.cardType !== 'stat-counter'
          ? 'slideup' : 'fadewhite';
        desiredFrames = 4;
      } else if (isRhythmicAccent) {
        kind = 'whip';
        transition = RHYTHMIC_WHIPS[i % RHYTHMIC_WHIPS.length];
        desiredFrames = 3;
      }
    }

    // Bound overlap by BOTH adjacent shots, including micro-beats.
    const maxOverlap = Math.floor(Math.min(frameCounts[i], frameCounts[i + 1]) * 0.35);
    const planned = Math.min(desiredFrames, maxOverlap);
    const overlapFrames = planned <= 1 ? 0 : planned;
    boundaries.push({
      kind: overlapFrames === 0 ? 'snap' : kind,
      transition: overlapFrames === 0 ? 'fade' : transition,
      overlapFrames,
    });
  }
  return boundaries;
}
