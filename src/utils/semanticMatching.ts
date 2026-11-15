/** Assign content-described stills to semantic spoken beats; no filename reliance. */
export interface CaptionCandidate {
  id: string;
  description: string;
}
export interface SemanticMatch {
  id: string;
  score: number;
  confidence: 'high' | 'medium' | 'low';
  explanation: string;
}

const STOP = new Set(
  'a an the and or to of on in at by for with as is are was were be been being it its they them he him his her she this that these those which who what we you i my our from over into around near here there then but just only very still could would should did do does not no now before after one some their more again when where all had have has up down out off inside outside so too every everywhere while until finally look looked looking little small suddenly'.split(' ')
);

const SYNONYMS: Record<string, string> = {
  bird: 'crow', raven: 'crow', crows: 'crow',
  beaks: 'beak', wings: 'wing', feathers: 'feather',
  vessel: 'pot', pitcher: 'pot', jar: 'pot', container: 'pot',
  pebble: 'stone', pebbles: 'stone', rocks: 'stone', rock: 'stone',
  sip: 'drink', sips: 'drink', drinking: 'drink', drank: 'drink', gulp: 'drink',
  flies: 'fly', flying: 'fly', flight: 'fly', flew: 'fly',
  landing: 'land', landed: 'land', lands: 'land',
  thirsty: 'thirst', thirsting: 'thirst',
  dry: 'drought', arid: 'drought', parched: 'drought',
  sun: 'sun', sunshine: 'sun', sunny: 'sun', sunlight: 'sun',
  tired: 'tired', exhausted: 'tired', weak: 'tired',
  splash: 'splash', splashing: 'splash',
  dropping: 'drop', dropped: 'drop', drops: 'drop', falling: 'drop', falls: 'drop',
  rising: 'rise', rises: 'rise', higher: 'rise', increased: 'rise',
  thinking: 'think', thinkingface: 'think', idea: 'think', pondering: 'think',
  searching: 'search', looking: 'search', hunts: 'search', seeking: 'search',
  happy: 'joy', joyful: 'joy', smiling: 'joy', celebration: 'joy', triumph: 'joy',
  frustrated: 'frustration', disappointed: 'frustration',
};

export function visualTokens(text: string): string[] {
  return Array.from(new Set(
    text.toLowerCase()
      .normalize('NFKD')
      .match(/[\p{L}\p{N}]+/gu)
      ?.map((word) => {
        const singular = word.length > 4 && word.endsWith('ies')
          ? word.slice(0, -3) + 'y'
          : word.length > 4 && word.endsWith('s') && !word.endsWith('ss')
            ? word.slice(0, -1) : word;
        return SYNONYMS[singular] || SYNONYMS[word] || singular;
      })
      .filter((word) => word.length >= 3 && !STOP.has(word)) || []
  ));
}

export function matchCaptionsToScriptBeats(
  beats: readonly string[],
  captions: readonly CaptionCandidate[]
): SemanticMatch[] {
  if (captions.length === 0) throw new Error('No visual descriptions available to match.');
  if (beats.length === 0) return [];

  const docs = captions.map((c) => new Set(visualTokens(c.description)));
  const df = new Map<string, number>();
  for (const doc of docs) for (const token of doc) df.set(token, (df.get(token) ?? 0) + 1);
  const used = new Map<string, number>();
  const results: SemanticMatch[] = [];

  const weight = (token: string) =>
    1.3 + Math.log((captions.length + 1) / (1 + (df.get(token) ?? 0)));

  for (let index = 0; index < beats.length; index++) {
    const primary = visualTokens(beats[index]);
    const context = visualTokens(
      [beats[index - 1] || '', beats[index + 1] || ''].join(' ')
    ).filter((word) => !primary.includes(word));
    const primaryWeight = primary.reduce((sum, word) => sum + weight(word), 0);
    const contextWeight = context.reduce((sum, word) => sum + weight(word), 0);
    const candidates = captions.map((asset, imgIndex) => {
      const doc = docs[imgIndex];
      const direct = primary.reduce((sum, word) => sum + (doc.has(word) ? weight(word) : 0), 0);
      const surrounding = context.reduce((sum, word) => sum + (doc.has(word) ? weight(word) : 0), 0);
      const relevance = (direct / Math.max(1, primaryWeight)) * 0.88 +
        (surrounding / Math.max(1, contextWeight)) * 0.12;
      const reusePenalty = (used.get(asset.id) ?? 0) * 0.27;
      const previousSamePenalty = results[index - 1]?.id === asset.id ? 0.18 : 0;
      return {
        asset,
        relevance,
        rank: relevance - reusePenalty - previousSamePenalty,
        imgIndex,
      };
    }).sort((a, b) => b.rank - a.rank || a.imgIndex - b.imgIndex);

    const best = candidates[0];
    const runnerUp = candidates[1];
    used.set(best.asset.id, (used.get(best.asset.id) ?? 0) + 1);

    const confidence: SemanticMatch['confidence'] =
      best.relevance >= 0.42 && best.rank - (runnerUp?.rank ?? -Infinity) >= 0.08
        ? 'high'
        : best.relevance >= 0.17
          ? 'medium' : 'low';
    results.push({
      id: best.asset.id,
      score: Number(best.relevance.toFixed(3)),
      confidence,
      explanation: `${confidence} confidence (${(best.relevance * 100).toFixed(0)}% lexical overlap): ${best.asset.description.slice(0, 135)}`,
    });
  }
  return results;
}
