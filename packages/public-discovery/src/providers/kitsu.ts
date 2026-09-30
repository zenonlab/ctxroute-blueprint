import { assertFavoriteProviderSearchQuery, createProviderCandidate, createProviderCandidateEnvelope, favoriteProviderPage, favoriteProviderPolicy } from '../provider-kit';
import type { FavoriteProviderCandidatePort, FavoriteProviderHydrationPort, FavoriteProviderReference, FavoriteProviderSearchQuery, ProviderCandidate, ResolutionProvider } from '../provider-kit';
import { z } from 'zod';
import { FavoriteProviderRateGate, readFavoriteProviderIdentityJson, readFavoriteProviderJson } from '../provider-http';
import type { FavoriteProviderFetch } from '../provider-http';

export const kitsuApiOrigin = 'https://kitsu.io/api/edge';
type KitsuProvider = Extract<ResolutionProvider, 'kitsu-anime' | 'kitsu-manga'>;
const nonEmptyString = z.string().trim().min(1);
const posterImageVariantSchema = z.string().nullable().optional();
const posterImageSchema = z.object({
  tiny: posterImageVariantSchema, small: posterImageVariantSchema, medium: posterImageVariantSchema, large: posterImageVariantSchema, original: posterImageVariantSchema,
}).passthrough();
const attributesSchema = z.object({
  abbreviatedTitles: z.array(nonEmptyString).max(256),
  ageRating: nonEmptyString.nullable().optional(),
  canonicalTitle: nonEmptyString,
  nsfw: z.boolean().optional(),
  slug: nonEmptyString,
  subtype: nonEmptyString.nullable(),
  status: nonEmptyString.optional(), startDate: nonEmptyString.nullable().optional(), endDate: nonEmptyString.nullable().optional(),
  episodeCount: z.number().int().nonnegative().nullable().optional(), chapterCount: z.number().int().nonnegative().nullable().optional(), volumeCount: z.number().int().nonnegative().nullable().optional(),
  userCount: z.number().int().nonnegative().nullable().optional(),
  posterImage: posterImageSchema.nullable().optional(),
  titles: z.record(z.string(), z.string().trim().nullable()).refine((value) => Object.keys(value).length <= 16),
}).strict();
const resourceSchema = z.object({ attributes: attributesSchema, id: nonEmptyString, type: z.enum(['anime', 'manga']),
  relationships: z.object({ mappings: z.object({ data: z.array(z.object({ id: nonEmptyString, type: z.literal('mappings') })).max(32).optional() }).passthrough().optional() }).passthrough().optional(),
}).passthrough();
const includedMappingsSchema = z.array(z.unknown()).max(640).optional();
const animeMappingSchema = z.object({ id: nonEmptyString, type: z.literal('mappings'), attributes: z.object({ externalSite: z.literal('anilist/anime'), externalId: z.string().regex(/^[1-9]\d{0,19}$/u) }) });
const searchSchema = z.object({
  data: z.array(resourceSchema).max(20),
  included: includedMappingsSchema,
  links: z.object({ next: z.url().nullable().optional() }).passthrough(),
  meta: z.object({ count: z.number().int().nonnegative() }).passthrough(),
}).passthrough();
const hydrationSchema = z.object({ data: resourceSchema, included: includedMappingsSchema }).passthrough();
type KitsuResource = z.infer<typeof resourceSchema>;
type MutableCandidate = { -readonly [Key in keyof ProviderCandidate]: ProviderCandidate[Key] };
interface SearchProjection { readonly candidate?: ProviderCandidate; readonly incomplete: boolean }
const documentedNonAdultAgeRatings = new Set(['G', 'PG', 'R']);
const posterImageOrder = ['large', 'medium', 'original', 'small', 'tiny'] as const;

function contentClassification(attributes: KitsuResource['attributes']): 'adult' | 'non-adult' | 'unknown' {
  const ageRating = attributes.ageRating?.trim().toLocaleUpperCase('en-US');
  if (attributes.nsfw === true || ageRating === 'R18') return 'adult';
  if (attributes.nsfw === false || (ageRating !== undefined && documentedNonAdultAgeRatings.has(ageRating))) return 'non-adult';
  return 'unknown';
}

function kind(provider: KitsuProvider): 'anime' | 'manga' {
  return provider === 'kitsu-anime' ? 'anime' : 'manga';
}

function sparseFields(provider: KitsuProvider): string {
  const common = ['slug', 'canonicalTitle', 'titles', 'abbreviatedTitles', 'subtype', 'ageRating', 'status', 'startDate', 'endDate', 'userCount', 'posterImage'];
  return [...common, ...(provider === 'kitsu-anime' ? ['nsfw', 'episodeCount'] : ['chapterCount', 'volumeCount'])].join(',');
}

function posterImage(attributes: KitsuResource['attributes']): string | undefined {
  const images = attributes.posterImage;
  if (images == null) return undefined;
  let selected: string | undefined;
  for (const variant of posterImageOrder) {
    const value = images[variant];
    if (value == null) continue;
    if (value.length === 0 || value.length > 2048) {
      continue;
    }
    try {
      const parsed = new URL(value);
      const exactOrigin = parsed.protocol === 'https:' && parsed.username === '' && parsed.password === '' && parsed.origin === 'https://media.kitsu.app';
      if (exactOrigin) selected ??= value;
    } catch {
      continue;
    }
  }
  return selected;
}

function candidate(resource: KitsuResource, provider: KitsuProvider, included: readonly unknown[] = []): SearchProjection {
  const expectedType = kind(provider);
  if (resource.type !== expectedType) return { incomplete: true };
  let encodedId: string; let encodedSlug: string;
  try {
    encodedId = encodeURIComponent(resource.id);
    encodedSlug = encodeURIComponent(resource.attributes.slug);
  } catch {
    return { incomplete: true };
  }
  const translatedTitles = Object.entries(resource.attributes.titles).filter((entry): entry is [string, string] => entry[1] !== null && entry[1].length > 0);
  const titles = [...new Set([resource.attributes.canonicalTitle, ...translatedTitles.map(([, title]) => title), ...resource.attributes.abbreviatedTitles])].slice(0, 16);
  const result: MutableCandidate = {
    contentClassification: contentClassification(resource.attributes),
    canonicalUrl: `https://kitsu.io/${expectedType}/${encodedId}/${encodedSlug}`,
    externalId: resource.id,
    mediaKind: expectedType === 'anime' ? 'ANIME' : 'MANGA',
    preSerialization: expectedType === 'manga' && /novel/iu.test(resource.attributes.subtype ?? ''),
    provider,
    titles,
    metadataVersion: 2,
    displayTitle: resource.attributes.titles.fr_fr || resource.attributes.titles.en || resource.attributes.canonicalTitle,
    titleVariants: [{ title: resource.attributes.canonicalTitle }, ...translatedTitles.map(([language, title]) => ({ language: language.replace('_', '-'), title })), ...resource.attributes.abbreviatedTitles.map((title) => ({ title }))].slice(0, 16),
  };
  if (provider === 'kitsu-anime') {
    const related = new Set(resource.relationships?.mappings?.data?.map(mapping => mapping.id) ?? []);
    const identities = new Set(included.flatMap(value => {
      const parsed = animeMappingSchema.safeParse(value);
      return parsed.success && related.has(parsed.data.id) ? [parsed.data.attributes.externalId] : [];
    }));
    const identity = [...identities][0];
    if (identities.size === 1 && identity !== undefined) result.linkedReferences = [{ provider: 'anilist', externalId: identity }];
  }
  const cover = posterImage(resource.attributes);
  if (cover !== undefined) result.cover = { attribution: 'Kitsu', url: cover };
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
  return { candidate: createProviderCandidate(result, provider), incomplete: false };
}

function endpoint(provider: KitsuProvider, id?: string): string {
  const media = kind(provider);
  if (id !== undefined) {
    const url = new URL(`${kitsuApiOrigin}/${media}/${encodeURIComponent(id)}`);
    setProjectionFields(url, provider);
    return url.href;
  }
  return `${kitsuApiOrigin}/${media}`;
}

function setProjectionFields(url: URL, provider: KitsuProvider): void {
  url.searchParams.set(`fields[${kind(provider)}]`, sparseFields(provider) + (provider === 'kitsu-anime' ? ',mappings' : ''));
  if (provider === 'kitsu-anime') {
    url.searchParams.set('include', 'mappings');
    url.searchParams.set('fields[mappings]', 'externalSite,externalId');
  }
}

export class KitsuFavoriteProviderAdapter implements FavoriteProviderCandidatePort, FavoriteProviderHydrationPort {
  constructor(
    private readonly provider: KitsuProvider,
    private readonly fetcher: FavoriteProviderFetch = fetch.bind(globalThis),
    private readonly gate = new FavoriteProviderRateGate(provider),
  ) {}

  async search(input: FavoriteProviderSearchQuery) {
    const query = assertFavoriteProviderSearchQuery(input);
    if (query.provider !== this.provider) throw new TypeError(`Kitsu adapter requires provider ${this.provider}.`);
    const page = favoriteProviderPage(query.cursor);
    const url = new URL(endpoint(this.provider));
    url.searchParams.set('filter[text]', query.titles[0] ?? '');
    url.searchParams.set('page[limit]', String(query.limit));
    url.searchParams.set('page[offset]', String((page - 1) * query.limit));
    setProjectionFields(url, this.provider);
    return this.gate.run(favoriteProviderPolicy[this.provider].minimumIntervalMs, async () => {
      const response = await readFavoriteProviderJson(this.fetcher, url.href, { headers: { Accept: 'application/vnd.api+json' }, method: 'GET' }, searchSchema);
      const projected = response.value.data.map((resource) => candidate(resource, this.provider, response.value.included));
      const candidates = projected.flatMap((item) => item.candidate === undefined ? [] : [item.candidate]);
      const upstreamTruncated = response.value.links.next != null || response.value.meta.count > (page - 1) * query.limit + response.value.data.length;
      const projectionIncomplete = projected.some((item) => item.incomplete);
      const truncated = upstreamTruncated || projectionIncomplete;
      const envelope = { candidates, complete: !truncated, digest: response.digest, provider: this.provider, truncated };
      return createProviderCandidateEnvelope(upstreamTruncated && !projectionIncomplete ? { ...envelope, nextCursor: String(page + 1) } : envelope);
    });
  }

  async hydrate(reference: FavoriteProviderReference) {
    if (reference.provider !== this.provider || !/^\d+$/u.test(reference.externalId)) throw new TypeError(`Kitsu hydration requires a numeric ${this.provider} reference.`);
    return this.gate.run(favoriteProviderPolicy[this.provider].minimumIntervalMs, async () => {
      const response = await readFavoriteProviderIdentityJson(this.fetcher, endpoint(this.provider, reference.externalId), { headers: { Accept: 'application/vnd.api+json' }, method: 'GET' }, hydrationSchema);
      if (response === undefined) return undefined;
      const hydrated = candidate(response.value.data, this.provider, response.value.included).candidate;
      if (hydrated === undefined || hydrated.externalId !== reference.externalId) throw new Error('Kitsu hydration returned a different media identity.');
      return hydrated;
    });
  }
}
