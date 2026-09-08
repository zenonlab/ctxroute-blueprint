import { assertFavoriteProviderSearchQuery, favoriteProviderPage, favoriteProviderPolicy } from '@tobirink/application';
import type { FavoriteProviderCandidatePort, FavoriteProviderHydrationPort, FavoriteProviderReference, FavoriteProviderSearchQuery, ResolutionProvider } from '@tobirink/application';
import { createProviderCandidateEnvelope } from '@tobirink/domain';
import type { ProviderCandidate } from '@tobirink/domain';
import { z } from 'zod';
import { FavoriteProviderRateGate, readFavoriteProviderIdentityJson, readFavoriteProviderJson } from './provider-http';
import type { FavoriteProviderFetch } from './provider-http';

export const kitsuApiOrigin = 'https://kitsu.io/api/edge';
type KitsuProvider = Extract<ResolutionProvider, 'kitsu-anime' | 'kitsu-manga'>;
const nonEmptyString = z.string().trim().min(1);
const attributesSchema = z.object({
  abbreviatedTitles: z.array(nonEmptyString).max(16),
  ageRating: nonEmptyString.nullable(),
  canonicalTitle: nonEmptyString,
  nsfw: z.boolean(),
  slug: nonEmptyString,
  subtype: nonEmptyString.nullable(),
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
  const titles = [...new Set([resource.attributes.canonicalTitle, ...Object.values(resource.attributes.titles), ...resource.attributes.abbreviatedTitles])];
  const result: MutableCandidate = {
    canonicalUrl: `https://kitsu.io/${expectedType}/${encodeURIComponent(resource.id)}/${encodeURIComponent(resource.attributes.slug)}`,
    externalId: resource.id,
    mediaKind: expectedType === 'anime' ? 'ANIME' : 'MANGA',
    preSerialization: expectedType === 'manga' && /novel/iu.test(resource.attributes.subtype ?? ''),
    provider,
    titles,
  };
  if (resource.attributes.subtype !== null) result.format = resource.attributes.subtype;
  if (resource.attributes.nsfw || resource.attributes.ageRating === 'R18') result.categories = ['Adult'];
  return result;
}

function endpoint(provider: KitsuProvider, id?: string): string {
  const media = kind(provider);
  if (id !== undefined) return `${kitsuApiOrigin}/${media}/${encodeURIComponent(id)}?fields[${media}]=slug,canonicalTitle,titles,abbreviatedTitles,subtype,nsfw,ageRating`;
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
    url.searchParams.set(`fields[${media}]`, 'slug,canonicalTitle,titles,abbreviatedTitles,subtype,nsfw,ageRating');
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
