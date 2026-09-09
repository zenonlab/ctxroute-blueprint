import { assertFavoriteProviderSearchQuery, favoriteProviderPage, favoriteProviderPolicy } from '@tobirink/application';
import type { FavoriteProviderCandidatePort, FavoriteProviderHydrationPort, FavoriteProviderReference, FavoriteProviderSearchQuery } from '@tobirink/application';
import { createProviderCandidateEnvelope } from '@tobirink/domain';
import type { FavoriteMediaKind, ProviderCandidate } from '@tobirink/domain';
import { z } from 'zod';
import { FavoriteProviderRateGate, readFavoriteProviderIdentityJson, readFavoriteProviderJson } from './provider-http';
import type { FavoriteProviderFetch } from './provider-http';

export const mangaUpdatesApiOrigin = 'https://api.mangaupdates.com';
const seriesEndpoint = `${mangaUpdatesApiOrigin}/v1/series`;
const nonEmptyString = z.string().trim().min(1);
const identifierSchema = z.union([z.number().int().positive(), nonEmptyString]).transform(String);
const mangaUpdatesSeriesSchema = z.object({
  associated: z.array(z.object({ title: nonEmptyString }).strict()).max(16).optional().default([]),
  categories: z.array(z.object({ category: nonEmptyString }).strict()).max(16).optional().default([]),
  genres: z.array(z.object({ genre: nonEmptyString }).strict()).max(16).optional().default([]),
  year: z.union([z.number().int(), z.string()]).optional(), status: nonEmptyString.optional(),
  series_id: identifierSchema,
  title: nonEmptyString,
  type: nonEmptyString,
  url: z.url().optional(),
}).passthrough();
const mangaUpdatesResultSchema = z.object({ record: mangaUpdatesSeriesSchema }).passthrough();
const mangaUpdatesSearchSchema = z.object({ results: z.array(mangaUpdatesResultSchema).max(20), total_hits: z.number().int().nonnegative() }).passthrough();
type MangaUpdatesSeries = z.infer<typeof mangaUpdatesSeriesSchema>;
type MutableCandidate = { -readonly [Key in keyof ProviderCandidate]: ProviderCandidate[Key] };

function mediaKind(value: string): Exclude<FavoriteMediaKind, 'ANIME' | 'UNKNOWN'> {
  const normalized = value.toLocaleLowerCase();
  if (normalized === 'manhwa') return 'MANHWA';
  if (normalized === 'manhua') return 'MANHUA';
  return 'MANGA';
}

function candidate(series: MangaUpdatesSeries): ProviderCandidate {
  const result: MutableCandidate = {
    externalId: series.series_id,
    format: series.type,
    mediaKind: mediaKind(series.type),
    preSerialization: /novel/iu.test(series.type),
    provider: 'mangaupdates',
    titles: [...new Set([series.title, ...series.associated.map((item) => item.title)])],
    metadataVersion: 1,
  };
  if (series.url !== undefined) result.canonicalUrl = series.url;
  if (series.genres.length > 0) result.genres = series.genres.map((item) => item.genre);
  if (series.categories.length > 0) result.categories = series.categories.map((item) => item.category);
  const year = Number(series.year);
  if (Number.isSafeInteger(year) && year >= 1800 && year <= 3000) result.startYear = year;
  if (series.status !== undefined) {
    const value = series.status.toLocaleLowerCase();
    result.editorialStatus = /cancel|discontinu/iu.test(value) ? 'CANCELLED' : /hiatus|pause/iu.test(value) ? 'HIATUS' : /complete|finish/iu.test(value) ? 'COMPLETED' : /ongoing|active|publish/iu.test(value) ? 'ONGOING' : 'UNKNOWN';
  }
  return result;
}

export class MangaUpdatesFavoriteProviderAdapter implements FavoriteProviderCandidatePort, FavoriteProviderHydrationPort {
  constructor(private readonly fetcher: FavoriteProviderFetch = fetch, private readonly gate = new FavoriteProviderRateGate('mangaupdates')) {}

  async search(input: FavoriteProviderSearchQuery) {
    const query = assertFavoriteProviderSearchQuery(input);
    if (query.provider !== 'mangaupdates') throw new TypeError('MangaUpdates adapter requires provider mangaupdates.');
    const page = favoriteProviderPage(query.cursor);
    const response = await this.gate.run(favoriteProviderPolicy.mangaupdates.minimumIntervalMs, () => readFavoriteProviderJson(this.fetcher, `${seriesEndpoint}/search`, {
      body: JSON.stringify({ page, perpage: query.limit, search: query.titles[0] }),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
    }, mangaUpdatesSearchSchema));
    const candidates = response.value.results.map((result) => candidate(result.record));
    if (candidates.length > query.limit) throw new RangeError('MangaUpdates result exceeds the requested limit.');
    const truncated = response.value.total_hits > (page - 1) * query.limit + candidates.length;
    const envelope = { candidates, complete: !truncated, digest: response.digest, provider: 'mangaupdates' as const, truncated };
    return createProviderCandidateEnvelope(truncated ? { ...envelope, nextCursor: String(page + 1) } : envelope);
  }

  async hydrate(reference: FavoriteProviderReference) {
    if (reference.provider !== 'mangaupdates' || !/^[1-9]\d{0,18}$/u.test(reference.externalId)) throw new TypeError('MangaUpdates hydration requires a numeric MangaUpdates reference.');
    const response = await this.gate.run(favoriteProviderPolicy.mangaupdates.minimumIntervalMs, () => readFavoriteProviderIdentityJson(this.fetcher, `${seriesEndpoint}/${encodeURIComponent(reference.externalId)}`, { headers: { Accept: 'application/json' }, method: 'GET' }, mangaUpdatesSeriesSchema));
    if (response === undefined) return undefined;
    const hydrated = candidate(response.value);
    if (hydrated.externalId !== reference.externalId) throw new Error('MangaUpdates hydration returned a different series identity.');
    return hydrated;
  }
}
