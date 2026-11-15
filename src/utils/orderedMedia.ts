/**
 * Safe no-AI storyboard policy.
 * A filename heuristic must NEVER pretend it has inspected an image.
 * Numbered Veo scenes are sorted by their explicit scene prefix; otherwise
 * the user's upload order is authoritative.
 */
export function orderMediaByShotNumber<T extends { originalName: string }>(media: readonly T[]): T[] {
  const numbers = media.map((item) => {
    const name = item.originalName.trim();
    const match = /^(?:(?:scene|shot|frame|image|img|visual|picture|pic)[ ._-]*)?(\d{1,3})(?=[ ._-]|$)/i.exec(name);
    return match ? Number(match[1]) : null;
  });
  if (numbers.some((n) => n === null) ||
      new Set(numbers).size !== media.length) {
    return [...media];
  }
  return media
    .map((item, index) => ({ item, number: numbers[index]! }))
    .sort((a, b) => a.number - b.number)
    .map(({ item }) => item);
}

export function selectMediaForBeat<T>(
  orderedMedia: readonly T[],
  beatIndex: number,
  totalBeats: number
): T {
  if (orderedMedia.length === 0) {
    throw new Error('At least one visual asset is needed.');
  }
  if (!Number.isInteger(beatIndex) || beatIndex < 0 ||
      !Number.isInteger(totalBeats) || totalBeats <= 0 || beatIndex >= totalBeats) {
    throw new Error('Invalid storyboard beat index.');
  }
  const index = Math.min(
    orderedMedia.length - 1,
    Math.floor((beatIndex * orderedMedia.length) / totalBeats)
  );
  return orderedMedia[index];
}
