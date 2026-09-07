import { favoriteTitleByteLimit, utf8ByteLength } from '@tobirink/domain';

const insignificantTokens = new Set([
  'a', 'an', 'and', 'chapter', 'chapitre', 'de', 'des', 'dub', 'episode', 'et',
  'la', 'le', 'les', 'of', 'saison', 'season', 'sub', 'the', 'vf', 'vo', 'vostfr',
]);

export interface NormalizedFavoriteTitle {
  readonly compact: string;
  readonly normalized: string;
  readonly significantTokens: readonly string[];
}

export function normalizeFavoriteTitle(value: string): NormalizedFavoriteTitle {
  if (utf8ByteLength(value) > favoriteTitleByteLimit) throw new RangeError(`title exceeds ${favoriteTitleByteLimit} UTF-8 bytes.`);
  const normalized = value
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
  const tokens = normalized.length === 0 ? [] : normalized.split(' ');
  return Object.freeze({
    compact: normalized.replaceAll(' ', ''),
    normalized,
    significantTokens: Object.freeze(tokens.filter((token) => !insignificantTokens.has(token))),
  });
}

function editThreshold(left: string, right: string): number {
  return Math.min(2, Math.floor(Math.max(left.length, right.length) / 8));
}

export function isWithinFavoriteEditDistance(left: string, right: string): boolean {
  const limit = editThreshold(left, right);
  if (limit === 0 || Math.abs(left.length - right.length) > limit) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = Array.from({ length: right.length + 1 }, () => limit + 1);
    current[0] = leftIndex;
    const start = Math.max(1, leftIndex - limit);
    const end = Math.min(right.length, leftIndex + limit);
    let rowMinimum = leftIndex;
    for (let rightIndex = start; rightIndex <= end; rightIndex += 1) {
      const insertion = (current[rightIndex - 1] ?? limit + 1) + 1;
      const deletion = (previous[rightIndex] ?? limit + 1) + 1;
      const substitution = (previous[rightIndex - 1] ?? limit + 1) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      const distance = Math.min(insertion, deletion, substitution);
      current[rightIndex] = distance;
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > limit) return false;
    previous = current;
  }
  return (previous[right.length] ?? limit + 1) <= limit;
}
