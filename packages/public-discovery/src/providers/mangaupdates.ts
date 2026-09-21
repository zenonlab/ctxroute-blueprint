import { assertFavoriteProviderSearchQuery, createProviderCandidate, createProviderCandidateEnvelope, favoriteProviderInspectionLimit, favoriteProviderPage, favoriteProviderPolicy, inspectFavoriteTitleCandidates } from '../provider-kit.js';
import type { FavoriteMediaKind, FavoriteProviderCandidatePort, FavoriteProviderHydrationPort, FavoriteProviderReference, FavoriteProviderSearchQuery, ProviderCandidate } from '../provider-kit.js';
import { z } from 'zod';
import { FavoriteProviderRateGate, readFavoriteProviderIdentityJson, readFavoriteProviderJson } from '../provider-http.js';
import type { FavoriteProviderFetch } from '../provider-http.js';

export const mangaUpdatesApiOrigin = 'https://api.mangaupdates.com';
const seriesEndpoint = `${mangaUpdatesApiOrigin}/v1/series`;
const nonEmptyString = z.string().trim().min(1);
const identifierSchema = z.union([z.number().int().positive(), nonEmptyString]).transform(String);
const mangaUpdatesImageSchema = z.object({
  url: z.object({ original: z.url().nullish(), thumb: z.url().nullish() }).passthrough(),
}).passthrough();
const mangaUpdatesSeriesSchema = z.object({
  // MangaUpdates adds provider-owned metadata to these records on the detail
  // route (for example votes and added_by). Keep the internal projection
  // bounded while accepting additive upstream fields.
  associated: z.array(z.object({ title: nonEmptyString }).passthrough()).max(16).optional().default([]),
  categories: z.array(z.object({ category: nonEmptyString }).passthrough()).max(16).optional().default([]),
  genres: z.array(z.object({ genre: nonEmptyString }).passthrough()).max(16).optional().default([]),
  image: mangaUpdatesImageSchema.optional(),
  year: z.union([z.number().int(), z.string()]).optional(), status: nonEmptyString.optional(),
  series_id: identifierSchema,
  title: nonEmptyString,
  type: nonEmptyString,
  url: z.url().optional(),
}).passthrough();
const mangaUpdatesResultSchema = z.object({ record: mangaUpdatesSeriesSchema }).passthrough();
const mangaUpdatesSearchSchema = z.object({ results: z.array(mangaUpdatesResultSchema).max(favoriteProviderInspectionLimit), total_hits: z.number().int().nonnegative() }).passthrough();
type MangaUpdatesSeries = z.infer<typeof mangaUpdatesSeriesSchema>;
type MutableCandidate = { -readonly [Key in keyof ProviderCandidate]: ProviderCandidate[Key] };
const adultLabels = new Set(['adult', 'erotica', 'hentai', 'lolicon', 'pornographic', 'shotacon', 'smut']);

function mediaKind(value: string): Exclude<FavoriteMediaKind, 'ANIME' | 'UNKNOWN'> {
  const normalized = value.toLocaleLowerCase();
  if (normalized === 'manhwa') return 'MANHWA';
  if (normalized === 'manhua') return 'MANHUA';
  return 'MANGA';
}

function candidate(series: MangaUpdatesSeries): ProviderCandidate {
  const result: MutableCandidate = {
    contentClassification: [...series.genres.map(({ genre }) => genre), ...series.categories.map(({ category }) => category)].some((value) => adultLabels.has(value.trim().toLocaleLowerCase('en-US'))) ? 'adult' : 'unknown',
    externalId: series.series_id,
    format: series.type,
    mediaKind: mediaKind(series.type),
    preSerialization: /novel/iu.test(series.type),
    provider: 'mangaupdates',
    titles: [...new Set([series.title, ...series.associated.map((item) => item.title)])],
    metadataVersion: 2,
    displayTitle: series.title,
    titleVariants: [{ title: series.title }, ...series.associated.map((item) => ({ title: item.title }))].slice(0, 16),
  };
  const coverUrl = series.image?.url.original ?? series.image?.url.thumb;
  if (coverUrl != null) result.cover = { attribution: 'MangaUpdates', url: coverUrl };
  if (series.url !== undefined) result.canonicalUrl = series.url;
  if (series.genres.length > 0) result.genres = series.genres.map((item) => item.genre);
  if (series.categories.length > 0) result.categories = series.categories.map((item) => item.category);
  const year = Number(series.year);
  if (Number.isSafeInteger(year) && year >= 1800 && year <= 3000) result.startYear = year;
  if (series.status !== undefined) {
    const value = series.status.toLocaleLowerCase();
    result.editorialStatus = /cancel|discontinu/iu.test(value) ? 'CANCELLED' : /hiatus|pause/iu.test(value) ? 'HIATUS' : /complete|finish/iu.test(value) ? 'COMPLETED' : /ongoing|active|publish/iu.test(value) ? 'ONGOING' : 'UNKNOWN';
  }
  return createProviderCandidate(result, 'mangaupdates');
}

export class MangaUpdatesFavoriteProviderAdapter implements FavoriteProviderCandidatePort, FavoriteProviderHydrationPort {
  constructor(private readonly fetcher: FavoriteProviderFetch = fetch.bind(globalThis), private readonly gate = new FavoriteProviderRateGate('mangaupdates')) {}

  async search(input: FavoriteProviderSearchQuery) {
    const query = assertFavoriteProviderSearchQuery(input);
    if (query.provider !== 'mangaupdates') throw new TypeError('MangaUpdates adapter requires provider mangaupdates.');
    const page = favoriteProviderPage(query.cursor);
    const response = await this.gate.run(favoriteProviderPolicy.mangaupdates.minimumIntervalMs, () => readFavoriteProviderJson(this.fetcher, `${seriesEndpoint}/search`, {
      body: JSON.stringify({ page, perpage: favoriteProviderInspectionLimit, search: query.titles[0] }),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
    }, mangaUpdatesSearchSchema));
    const inspected = response.value.results.map((result) => candidate(result.record));
    const matchQuery = query.explicitProviderReference === undefined ? { sourceTitles: query.titles } : { sourceTitles: query.titles, explicitProviderReference: query.explicitProviderReference };
    const evidence = inspectFavoriteTitleCandidates(matchQuery, inspected);
    const references = new Set(evidence.candidateReferences.map((reference) => `${reference.provider}:${reference.externalId}`));
    const candidates = inspected.filter((item) => references.has(`${item.provider}:${item.externalId}`));
    if (candidates.length > query.limit) throw new RangeError('MangaUpdates has more comparable identities than the bounded candidate contract permits.');
    const truncated = response.value.total_hits > page * favoriteProviderInspectionLimit;
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
