import { assertFavoriteProviderSearchQuery, favoriteProviderPage, favoriteProviderPolicy } from '@tobirink/application';
import type { FavoriteProviderCandidatePort, FavoriteProviderHydrationPort, FavoriteProviderReference, FavoriteProviderSearchQuery, ResolutionProvider } from '@tobirink/application';
import { createProviderCandidate, createProviderCandidateEnvelope } from '@tobirink/domain';
import type { ProviderCandidate } from '@tobirink/domain';
import { z } from 'zod';
import { FavoriteProviderRateGate, readFavoriteProviderIdentityJson, readFavoriteProviderJson } from './provider-http';
import type { FavoriteProviderFetch } from './provider-http';

export const kitsuApiOrigin = 'https://kitsu.io/api/edge';
type KitsuProvider = Extract<ResolutionProvider, 'kitsu-anime' | 'kitsu-manga'>;
const nonEmptyString = z.string().trim().min(1);
const posterImageSchema = z.object({
  tiny: z.url().nullable().optional(), small: z.url().nullable().optional(), medium: z.url().nullable().optional(), large: z.url().nullable().optional(), original: z.url().nullable().optional(),
}).passthrough();
const attributesSchema = z.object({
  abbreviatedTitles: z.array(nonEmptyString).max(16),
  ageRating: nonEmptyString.nullable(),
  canonicalTitle: nonEmptyString,
  nsfw: z.boolean(),
  slug: nonEmptyString,
  subtype: nonEmptyString.nullable(),
  status: nonEmptyString.optional(), startDate: nonEmptyString.nullable().optional(), endDate: nonEmptyString.nullable().optional(),
  episodeCount: z.number().int().nonnegative().nullable().optional(), chapterCount: z.number().int().nonnegative().nullable().optional(), volumeCount: z.number().int().nonnegative().nullable().optional(),
  userCount: z.number().int().nonnegative().nullable().optional(),
  posterImage: posterImageSchema.nullable().optional(),
  titles: z.record(z.string(), nonEmptyString).refine((value) => Object.keys(value).length <= 16),
}).strict();
const resourceSchema = z.object({ attributes: attributesSchema, id: nonEmptyString, type: z.enum(['anime', 'manga']) }).passthrough();
const searchSchema = z.object({
  data: z.array(resourceSchema).max(20),
  links: z.object({ next: z.url().nullable().optional() }).passthrough(),
  meta: z.object({ count: z.number().int().nonnegative() }).passthrough(),
}).passthrough();
const hydrationSchema = z.object({ data: resourceSchema }).passthrough();
type KitsuResource = z.infer<typeof resourceSchema>;
type MutableCandidate = { -readonly [Key in keyof ProviderCandidate]: ProviderCandidate[Key] };

function kind(provider: KitsuProvider): 'anime' | 'manga' {
  return provider === 'kitsu-anime' ? 'anime' : 'manga';
}

function candidate(resource: KitsuResource, provider: KitsuProvider): ProviderCandidate {
  const expectedType = kind(provider);
  if (resource.type !== expectedType) throw new Error('Kitsu returned a different media type.');
  const titles = [...new Set([resource.attributes.canonicalTitle, ...Object.values(resource.attributes.titles), ...resource.attributes.abbreviatedTitles])].slice(0, 16);
  const result: MutableCandidate = {
    canonicalUrl: `https://kitsu.io/${expectedType}/${encodeURIComponent(resource.id)}/${encodeURIComponent(resource.attributes.slug)}`,
    externalId: resource.id,
    mediaKind: expectedType === 'anime' ? 'ANIME' : 'MANGA',
    preSerialization: expectedType === 'manga' && /novel/iu.test(resource.attributes.subtype ?? ''),
    provider,
    titles,
    metadataVersion: 2,
    displayTitle: resource.attributes.titles.fr_fr ?? resource.attributes.titles.en ?? resource.attributes.canonicalTitle,
    titleVariants: [{ title: resource.attributes.canonicalTitle }, ...Object.entries(resource.attributes.titles).map(([language, title]) => ({ language: language.replace('_', '-'), title })), ...resource.attributes.abbreviatedTitles.map((title) => ({ title }))].slice(0, 16),
  };
  const coverUrl = resource.attributes.posterImage?.large ?? resource.attributes.posterImage?.medium ?? resource.attributes.posterImage?.original ?? resource.attributes.posterImage?.small ?? resource.attributes.posterImage?.tiny;
  if (coverUrl != null) result.cover = { attribution: 'Kitsu', url: coverUrl };
  if (resource.attributes.subtype !== null) result.format = resource.attributes.subtype;
  if (resource.attributes.nsfw || resource.attributes.ageRating === 'R18') result.categories = ['Adult'];
  const status = resource.attributes.status?.toLocaleLowerCase();
  if (status !== undefined) result.editorialStatus = status === 'current' ? 'ONGOING' : status === 'finished' ? 'COMPLETED' : status === 'unreleased' || status === 'upcoming' ? 'UPCOMING' : 'UNKNOWN';
  const startYear = Number(resource.attributes.startDate?.slice(0, 4)); const endYear = Number(resource.attributes.endDate?.slice(0, 4));
  if (Number.isSafeInteger(startYear) && startYear >= 1800 && startYear <= 3000) result.startYear = startYear;
  if (Number.isSafeInteger(endYear) && endYear >= 1800 && endYear <= 3000) result.endYear = endYear;
  if (resource.attributes.episodeCount != null) result.episodeCount = resource.attributes.episodeCount;
  if (resource.attributes.chapterCount != null) result.chapterCount = resource.attributes.chapterCount;
  if (resource.attributes.volumeCount != null) result.volumeCount = resource.attributes.volumeCount;
  if (resource.attributes.userCount != null) result.popularity = { kind: 'MEMBERS', value: resource.attributes.userCount };
  return createProviderCandidate(result, provider);
}

function endpoint(provider: KitsuProvider, id?: string): string {
  const media = kind(provider);
  if (id !== undefined) return `${kitsuApiOrigin}/${media}/${encodeURIComponent(id)}?fields[${media}]=slug,canonicalTitle,titles,abbreviatedTitles,subtype,nsfw,ageRating,status,startDate,endDate,episodeCount,chapterCount,volumeCount,userCount,posterImage`;
  return `${kitsuApiOrigin}/${media}`;
}

export class KitsuFavoriteProviderAdapter implements FavoriteProviderCandidatePort, FavoriteProviderHydrationPort {
  constructor(
    private readonly provider: KitsuProvider,
    private readonly fetcher: FavoriteProviderFetch = fetch,
    private readonly gate = new FavoriteProviderRateGate(provider),
  ) {}

  async search(input: FavoriteProviderSearchQuery) {
    const query = assertFavoriteProviderSearchQuery(input);
    if (query.provider !== this.provider) throw new TypeError(`Kitsu adapter requires provider ${this.provider}.`);
    const media = kind(this.provider);
    const page = favoriteProviderPage(query.cursor);
    const url = new URL(endpoint(this.provider));
    url.searchParams.set('filter[text]', query.titles[0] ?? '');
    url.searchParams.set('page[limit]', String(query.limit));
    url.searchParams.set('page[offset]', String((page - 1) * query.limit));
    url.searchParams.set(`fields[${media}]`, 'slug,canonicalTitle,titles,abbreviatedTitles,subtype,nsfw,ageRating,status,startDate,endDate,episodeCount,chapterCount,volumeCount,userCount,posterImage');
    const response = await this.gate.run(favoriteProviderPolicy[this.provider].minimumIntervalMs, () => readFavoriteProviderJson(this.fetcher, url.href, { headers: { Accept: 'application/vnd.api+json' }, method: 'GET' }, searchSchema));
    const candidates = response.value.data.map((resource) => candidate(resource, this.provider));
    const truncated = response.value.links.next != null || response.value.meta.count > (page - 1) * query.limit + candidates.length;
    const envelope = { candidates, complete: !truncated, digest: response.digest, provider: this.provider, truncated };
    return createProviderCandidateEnvelope(truncated ? { ...envelope, nextCursor: String(page + 1) } : envelope);
  }

  async hydrate(reference: FavoriteProviderReference) {
    if (reference.provider !== this.provider || !/^\d+$/u.test(reference.externalId)) throw new TypeError(`Kitsu hydration requires a numeric ${this.provider} reference.`);
    const response = await this.gate.run(favoriteProviderPolicy[this.provider].minimumIntervalMs, () => readFavoriteProviderIdentityJson(this.fetcher, endpoint(this.provider, reference.externalId), { headers: { Accept: 'application/vnd.api+json' }, method: 'GET' }, hydrationSchema));
    if (response === undefined) return undefined;
    const hydrated = candidate(response.value.data, this.provider);
    if (hydrated.externalId !== reference.externalId) throw new Error('Kitsu hydration returned a different media identity.');
    return hydrated;
  }
}
