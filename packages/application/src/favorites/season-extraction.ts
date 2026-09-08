import type { SourceEvidence } from '@tobirink/domain';

export interface FavoriteSeasonAnalysis {
  readonly bareTrailingNumber?: number;
  readonly canonicalSeason?: number;
  readonly conflict: boolean;
  readonly titleSeason?: number;
  readonly urlSeason?: number;
}
interface MutableFavoriteSeasonAnalysis { bareTrailingNumber?: number; canonicalSeason?: number; conflict: boolean; titleSeason?: number; urlSeason?: number }

const labelledSeason = /(?:\b(?:s|season|saison|temporada|stagione|staffel|seizoen|sesong|säsong|kausi|sezon|sezona|sezonas|сезон)[\s._-]*([1-9]\d?)\b)|(?:\b([1-9]\d?)(?:st|nd|rd|th|er|e|eme|ème)[\s._-]+season\b)/giu;

export function readLabelledFavoriteSeason(value: string): number | undefined {
  let found: number | undefined;
  for (const match of value.matchAll(labelledSeason)) {
    const raw = match[1] ?? match[2];
    if (raw !== undefined) found = Number(raw);
  }
  return found;
}

export function stripFavoriteSeasonSuffix(value: string, season: number): string {
  const trimmed = value.trim();
  for (const match of trimmed.matchAll(labelledSeason)) {
    if (Number(match[1] ?? match[2]) === season && match.index + match[0].length === trimmed.length) return trimmed.slice(0, match.index).trim();
  }
  return trimmed;
}

export function extractFavoriteSeason(title: string, evidence: SourceEvidence): FavoriteSeasonAnalysis {
  const titleSeason = readLabelledFavoriteSeason(title);
  const urlSeason = evidence.season ?? readLabelledFavoriteSeason([evidence.path, evidence.rawSlug, evidence.stableSlug].filter((value) => value !== undefined).join(' '));
  const conflict = titleSeason !== undefined && urlSeason !== undefined && titleSeason !== urlSeason;
  const canonicalSeason = conflict ? undefined : (titleSeason ?? urlSeason);
  const bare = title.match(/(?:^|\s)([1-9]\d?)\s*$/u)?.[1];
  const result: MutableFavoriteSeasonAnalysis = { conflict };
  if (bare !== undefined && titleSeason === undefined) result.bareTrailingNumber = Number(bare);
  if (canonicalSeason !== undefined) result.canonicalSeason = canonicalSeason;
  if (titleSeason !== undefined) result.titleSeason = titleSeason;
  if (urlSeason !== undefined) result.urlSeason = urlSeason;
  return Object.freeze(result);
}
