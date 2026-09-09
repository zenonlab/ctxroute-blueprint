import { assertFavoriteProviderSearchQuery, favoriteProviderPage, favoriteProviderPolicy } from '@tobirink/application';
import type { FavoriteProviderCandidatePort, FavoriteProviderHydrationPort, FavoriteProviderReference, FavoriteProviderSearchQuery } from '@tobirink/application';
import { createProviderCandidateEnvelope } from '@tobirink/domain';
import type { ProviderCandidate } from '@tobirink/domain';
import { z } from 'zod';
import { FavoriteProviderRateGate, readFavoriteProviderJson } from './provider-http';
import type { FavoriteProviderFetch } from './provider-http';

export const anilistGraphqlEndpoint = 'https://graphql.anilist.co';
const mediaProjection = 'id type format status siteUrl title { romaji english native } synonyms genres startDate { year } endDate { year } episodes chapters volumes popularity';
const searchQuery = `query FavoriteSearch($search: String!, $perPage: Int!, $page: Int!) { Page(page: $page, perPage: $perPage) { pageInfo { hasNextPage } media(search: $search, type: ANIME) { ${mediaProjection} } } }`;
const hydrateQuery = `query FavoriteById($id: Int!) { Media(id: $id) { ${mediaProjection} } }`;
const nonEmptyString = z.string().trim().min(1);
const identifierSchema = z.union([z.number().int().positive(), nonEmptyString]).transform(String);
const anilistMediaSchema = z.object({
  format: nonEmptyString.nullable(),
  genres: z.array(nonEmptyString).max(16),
  status: z.enum(['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS']).optional(),
  startDate: z.object({ year: z.number().int().min(1800).max(3000).nullable() }).strict().optional(),
  endDate: z.object({ year: z.number().int().min(1800).max(3000).nullable() }).strict().optional(),
  episodes: z.number().int().nonnegative().nullable().optional(), chapters: z.number().int().nonnegative().nullable().optional(), volumes: z.number().int().nonnegative().nullable().optional(),
  popularity: z.number().int().nonnegative().nullable().optional(),
  id: identifierSchema,
  siteUrl: z.url().nullable(),
  synonyms: z.array(nonEmptyString).max(16),
  title: z.object({ english: nonEmptyString.nullable(), native: nonEmptyString.nullable(), romaji: nonEmptyString.nullable() }).strict(),
  type: z.enum(['ANIME', 'MANGA']),
}).strict();
const anilistSearchSchema = z.object({ data: z.object({ Page: z.object({ media: z.array(anilistMediaSchema).max(20), pageInfo: z.object({ hasNextPage: z.boolean() }).strict() }).strict() }).strict() }).strict();
const anilistHydrationSchema = z.object({ data: z.object({ Media: anilistMediaSchema.nullable() }).strict() }).strict();
type AniListMedia = z.infer<typeof anilistMediaSchema>;
type MutableCandidate = { -readonly [Key in keyof ProviderCandidate]: ProviderCandidate[Key] };

function titles(media: AniListMedia): readonly string[] {
  const values = [media.title.romaji, media.title.english, media.title.native, ...media.synonyms]
    .filter((value): value is string => value !== null);
  if (values.length === 0) throw new TypeError('AniList media requires a title.');
  return [...new Set(values)];
}

function candidate(media: AniListMedia): ProviderCandidate {
  const result: MutableCandidate = {
    externalId: media.id,
    mediaKind: media.type,
    preSerialization: media.type === 'MANGA' && /novel/iu.test(media.format ?? ''),
    provider: 'anilist',
    titles: titles(media),
    metadataVersion: 1,
  };
  if (media.siteUrl !== null) result.canonicalUrl = media.siteUrl;
  if (media.format !== null) result.format = media.format;
  if (media.genres.length > 0) result.genres = media.genres;
  if (media.status !== undefined) result.editorialStatus = ({ FINISHED: 'COMPLETED', RELEASING: 'ONGOING', NOT_YET_RELEASED: 'UPCOMING', CANCELLED: 'CANCELLED', HIATUS: 'HIATUS' } as const)[media.status];
  if (media.startDate?.year != null) result.startYear = media.startDate.year;
  if (media.endDate?.year != null) result.endYear = media.endDate.year;
  if (media.episodes != null) result.episodeCount = media.episodes;
  if (media.chapters != null) result.chapterCount = media.chapters;
  if (media.volumes != null) result.volumeCount = media.volumes;
  if (media.popularity != null) result.popularity = { kind: 'MEMBERS', value: media.popularity };
  return result;
}

export class AniListFavoriteProviderAdapter implements FavoriteProviderCandidatePort, FavoriteProviderHydrationPort {
  constructor(private readonly fetcher: FavoriteProviderFetch = fetch, private readonly gate = new FavoriteProviderRateGate('anilist')) {}

  async search(input: FavoriteProviderSearchQuery) {
    const query = assertFavoriteProviderSearchQuery(input);
    if (query.provider !== 'anilist') throw new TypeError('AniList adapter requires provider anilist.');
    const page = favoriteProviderPage(query.cursor);
    const response = await this.gate.run(favoriteProviderPolicy.anilist.minimumIntervalMs, () => readFavoriteProviderJson(this.fetcher, anilistGraphqlEndpoint, {
      body: JSON.stringify({ query: searchQuery, variables: { page, perPage: query.limit, search: query.titles[0] } }),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
    }, anilistSearchSchema));
    const candidates = response.value.data.Page.media.map(candidate);
    if (candidates.length > query.limit) throw new RangeError('AniList result exceeds the requested limit.');
    const truncated = response.value.data.Page.pageInfo.hasNextPage;
    const envelope = { candidates, complete: !truncated, digest: response.digest, provider: 'anilist' as const, truncated };
    return createProviderCandidateEnvelope(truncated ? { ...envelope, nextCursor: String(page + 1) } : envelope);
  }

  async hydrate(reference: FavoriteProviderReference) {
    if (reference.provider !== 'anilist' || !/^\d+$/u.test(reference.externalId)) throw new TypeError('AniList hydration requires a numeric AniList reference.');
    const response = await this.gate.run(favoriteProviderPolicy.anilist.minimumIntervalMs, () => readFavoriteProviderJson(this.fetcher, anilistGraphqlEndpoint, {
      body: JSON.stringify({ query: hydrateQuery, variables: { id: Number(reference.externalId) } }),
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      method: 'POST',
    }, anilistHydrationSchema));
    if (response.value.data.Media === null) return undefined;
    const hydrated = candidate(response.value.data.Media);
    if (hydrated.externalId !== reference.externalId) throw new Error('AniList hydration returned a different media identity.');
    return hydrated;
  }
}
