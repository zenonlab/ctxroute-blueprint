import { favoriteTitleByteLimit, utf8ByteLength } from '@tobirink/domain';

export const favoriteTitlePreparationVersion = 'favorite-title-preparation-v2';

export interface ParenthesizedFavoriteTitle {
  readonly alternate: string;
  readonly base: string;
}

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
    .replace(/[×✕]/gu, ' x ')
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

const parenthesizedQualifier = /^(?:\d{4}|\d+|anime|manga|manhua|manhwa|movie|film|novel|light\s+novel|web\s+novel|ova|oav|ona|tv|special|pre[-\s]?seriali[sz]ation|english|french|fran[cç]ais|japanese|japonais|korean|cor[eé]en|chinese|chinois)$/iu;

export function readSafeParenthesizedFavoriteTitle(value: string): ParenthesizedFavoriteTitle | undefined {
  const match = /^(?<base>[^()]+?)\s*\((?<alternate>[^()]+)\)\s*$/u.exec(value.trim());
  const base = match?.groups?.base?.trim();
  const alternate = match?.groups?.alternate?.trim();
  if (base === undefined || alternate === undefined || !/\p{L}/u.test(base) || !/\p{L}/u.test(alternate) || parenthesizedQualifier.test(alternate)) return undefined;
  return Object.freeze({ alternate, base });
}

function appendUnique(values: string[], value: string): void {
  const trimmed = value.trim();
  if (trimmed.length === 0) return;
  const key = normalizeFavoriteTitle(trimmed).normalized;
  if (key.length > 0 && !values.some((current) => normalizeFavoriteTitle(current).normalized === key)) values.push(trimmed);
}

export function favoriteProviderDiscoveryTitles(sourceTitles: readonly string[]): readonly string[] {
  const values: string[] = [];
  for (const title of sourceTitles) {
    appendUnique(values, title);
    const parenthesized = readSafeParenthesizedFavoriteTitle(title);
    if (parenthesized !== undefined) {
      appendUnique(values, parenthesized.base);
      appendUnique(values, parenthesized.alternate);
    }
    const firstClause = title.split(/[,;]/u, 1)[0]?.trim();
    if (firstClause !== undefined && normalizeFavoriteTitle(firstClause).significantTokens.length >= 3) appendUnique(values, firstClause);
    appendUnique(values, normalizeFavoriteTitle(title).normalized);
    appendUnique(values, normalizeFavoriteTitle(title).compact);
    if (values.length >= 4) break;
  }
  return Object.freeze(values.slice(0, 4));
}

export function hasFavoriteOvaMarker(values: readonly string[]): boolean {
  return values.some((value) => /(?:^|[^\p{L}\p{N}])(?:ova|oav)(?:$|[^\p{L}\p{N}])/iu.test(value));
}

export function hasFavoritePreSerializationMarker(values: readonly string[]): boolean {
  return values.some((value) => /(?:^|[^\p{L}\p{N}])(?:light\s+novel|web\s+novel|novel|pre[-\s]?seriali[sz]ation)(?:$|[^\p{L}\p{N}])/iu.test(value));
}

function editThreshold(left: string, right: string): number {
  const length = Math.max(left.length, right.length);
  return Math.min(left.length, right.length) < 5 ? 0 : Math.min(2, Math.max(1, Math.floor(length / 8)));
}

export function isWithinFavoriteEditDistance(left: string, right: string): boolean {
  const limit = editThreshold(left, right);
  if (limit === 0 || Math.abs(left.length - right.length) > limit) return false;
  let previous = new Map<number, number>();
  for (let rightIndex = 0; rightIndex <= Math.min(right.length, limit); rightIndex += 1) previous.set(rightIndex, rightIndex);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = new Map<number, number>();
    const start = Math.max(0, leftIndex - limit);
    const end = Math.min(right.length, leftIndex + limit);
    if (start === 0) current.set(0, leftIndex);
    let rowMinimum = limit + 1;
    for (let rightIndex = Math.max(1, start); rightIndex <= end; rightIndex += 1) {
      const insertion = (current.get(rightIndex - 1) ?? limit + 1) + 1;
      const deletion = (previous.get(rightIndex) ?? limit + 1) + 1;
      const substitution = (previous.get(rightIndex - 1) ?? limit + 1) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      const distance = Math.min(insertion, deletion, substitution);
      current.set(rightIndex, distance);
      rowMinimum = Math.min(rowMinimum, distance);
    }
    if (rowMinimum > limit) return false;
    previous = current;
  }
  return (previous.get(right.length) ?? limit + 1) <= limit;
}
