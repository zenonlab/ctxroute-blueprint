import { assertFavoriteProviderSearchQuery, createProviderCandidate, favoriteProviderPage, favoriteProviderPolicy, inspectFavoriteTitleCandidates } from '../provider-kit.js';
import type { FavoriteProviderCandidatePort, FavoriteProviderHydrationPort, FavoriteProviderReference, FavoriteProviderSearchQuery, ProviderCandidate } from '../provider-kit.js';
import { z } from 'zod';
import { FavoriteProviderRateGate, readFavoriteProviderIdentityJson, readFavoriteProviderJson } from '../provider-http.js';
import type { FavoriteProviderFetch } from '../provider-http.js';

type MutableCandidate = { -readonly [Key in keyof ProviderCandidate]: ProviderCandidate[Key] };

const uuid = z.uuid();
const titleMap = z.record(z.string().max(16), z.string().min(1).max(1024)).refine((value) => Object.keys(value).length <= 64);
const hydrationSchema = z.object({
  result: z.literal('ok'),
  data: z.object({
    id: uuid, type: z.literal('manga'),
    attributes: z.object({
      links: z.object({ mu: z.string().max(1024).nullable().optional() }).passthrough().nullable().optional(),
      title: titleMap, altTitles: z.array(titleMap).max(128), contentRating: z.enum(['safe', 'suggestive', 'erotica', 'pornographic']), originalLanguage: z.string().min(2).max(16),
      status: z.enum(['ongoing', 'completed', 'hiatus', 'cancelled']).optional(), year: z.number().int().min(1800).max(3000).nullable().optional(),
      tags: z.array(z.object({ attributes: z.object({ group: z.enum(['content', 'format', 'genre', 'theme']), name: titleMap }).passthrough() }).passthrough()).max(32).optional().default([]),
    }).passthrough(),
    relationships: z.array(z.object({
      attributes: z.object({ fileName: z.string().min(1).max(512) }).passthrough().optional(),
      id: uuid,
      type: z.string().min(1).max(64),
    }).passthrough()).max(64).optional().default([]),
  }),
});
type MangaDexData = z.infer<typeof hydrationSchema>['data'];
const searchSchema = z.object({ result: z.literal('ok'), data: z.array(z.record(z.string(), z.json())).max(20), limit: z.number().int().min(1).max(20), offset: z.number().int().nonnegative(), total: z.number().int().nonnegative() });
function contentClassification(value: MangaDexData['attributes']['contentRating']): 'adult' | 'non-adult' | 'unknown' {
  if (value === 'erotica' || value === 'pornographic') return 'adult';
  if (value === 'safe') return 'non-adult';
  return 'unknown';
}

export class MangaDexFavoriteProviderAdapter implements FavoriteProviderCandidatePort, FavoriteProviderHydrationPort {
  constructor(private readonly fetcher: FavoriteProviderFetch = fetch.bind(globalThis), private readonly gate = new FavoriteProviderRateGate('mangadex')) {}

  async search(input: FavoriteProviderSearchQuery) {
    const query = assertFavoriteProviderSearchQuery(input);
    if (input.provider !== 'mangadex') throw new TypeError('MangaDex adapter requires provider mangadex.');
    const title = input.titles[0]?.trim();
    if (!title) throw new TypeError('MangaDex search requires a title.');
    const page = favoriteProviderPage(query.cursor);
    const offset = (page - 1) * 20;
    const url = new URL('https://api.mangadex.org/manga'); url.searchParams.set('title', title.slice(0, 200)); url.searchParams.set('limit', '20'); url.searchParams.set('offset', String(offset)); url.searchParams.append('includes[]', 'cover_art');
    const response = await this.gate.run(favoriteProviderPolicy.mangadex.minimumIntervalMs, () => readFavoriteProviderJson(this.fetcher, url.toString(), { headers: { Accept: 'application/json' }, method: 'GET' }, searchSchema));
    const value = response.value;
    if (value.offset !== offset || value.limit !== 20 || value.data.length > value.limit || value.total < offset + value.data.length || (value.data.length < value.limit && value.total > offset + value.data.length)) throw new Error('MangaDex pagination is inconsistent.');
    const inspected = value.data.map((data) => this.candidateFromData(hydrationSchema.parse({ result: 'ok', data }).data));
    const matchQuery = query.explicitProviderReference === undefined ? { sourceTitles: query.titles } : { sourceTitles: query.titles, explicitProviderReference: query.explicitProviderReference };
    const evidence = inspectFavoriteTitleCandidates(matchQuery, inspected);
    const references = new Set(evidence.candidateReferences.map(reference => reference.externalId));
    const candidates = inspected.filter(candidate => references.has(candidate.externalId));
    if (candidates.length > query.limit) throw new Error('MangaDex comparable candidate limit exceeded.');
    const truncated = value.total > offset + value.data.length;
    const envelope = { candidates, complete: !truncated, digest: response.digest, provider: 'mangadex' as const, truncated };
    return truncated ? { ...envelope, nextCursor: String(page + 1) } : envelope;
  }

  private candidateFromData(data: MangaDexData): ProviderCandidate {
    const id = data.id.toLowerCase(); const attributes = data.attributes;
    const variants = [...Object.entries(attributes.title), ...attributes.altTitles.flatMap((value) => Object.entries(value))].map(([language, title]) => ({ language, title }));
    const titles = [...new Set(variants.map((variant) => variant.title))];
    const result: MutableCandidate = { canonicalUrl: `https://mangadex.org/title/${id}`, categories: attributes.contentRating === 'erotica' || attributes.contentRating === 'pornographic' ? ['Adult'] : [], contentClassification: contentClassification(attributes.contentRating), externalId: id, mediaKind: attributes.originalLanguage === 'ko' ? 'MANHWA' : attributes.originalLanguage.startsWith('zh') ? 'MANHUA' : 'MANGA', preSerialization: false, provider: 'mangadex', titles: titles.slice(0, 16), metadataVersion: 2, displayTitle: attributes.title.fr ?? attributes.title.en ?? attributes.title['ja-ro'] ?? titles[0], titleVariants: variants.slice(0, 16) };
    const fileName = data.relationships.find((relationship) => relationship.type === 'cover_art')?.attributes?.fileName;
    if (fileName !== undefined) result.cover = { attribution: 'MangaDex', url: `https://uploads.mangadex.org/covers/${id}/${encodeURIComponent(fileName)}.512.jpg` };
    const linked = this.mangaUpdatesReference(attributes.links?.mu);
    if (linked !== undefined) result.linkedReferences = [linked];
    return createProviderCandidate(result, 'mangadex');
  }

  private mangaUpdatesReference(value: string | null | undefined): FavoriteProviderReference | undefined {
    if (value == null) return undefined;
    // Bare decimal values are legacy series.html IDs, not API identities.
    const modern = /^https:\/\/(?:www\.)?mangaupdates\.com\/series\/([a-z0-9]{1,13})(?:\/[^?#]*)?$/iu.exec(value)?.[1];
    const slug = modern ?? (/^[a-z0-9]{1,13}$/iu.test(value) && /[a-z]/iu.test(value) ? value : undefined);
    if (slug === undefined) return undefined;
    const id = [...slug.toLowerCase()].reduce((total, digit) => total * 36n + BigInt(parseInt(digit, 36)), 0n);
    if (id === 0n || id > 9_223_372_036_854_775_807n) return undefined;
    return { externalId: id.toString(), provider: 'mangaupdates' };
  }

  async hydrate(reference: FavoriteProviderReference): Promise<ProviderCandidate | undefined> {
    if (reference.provider !== 'mangadex') throw new TypeError('MangaDex hydration requires a MangaDex reference.');
    const id = uuid.parse(reference.externalId).toLowerCase();
    const response = await this.gate.run(favoriteProviderPolicy.mangadex.minimumIntervalMs, () => readFavoriteProviderIdentityJson(this.fetcher, `https://api.mangadex.org/manga/${id}?includes%5B%5D=cover_art`, { headers: { Accept: 'application/json' }, method: 'GET' }, hydrationSchema));
    if (response === undefined) return undefined;
    if (response.value.data.id.toLowerCase() !== id) throw new Error('MangaDex hydration returned a different identity.');
    const attributes = response.value.data.attributes;
    const variants = [...Object.entries(attributes.title), ...attributes.altTitles.flatMap((value) => Object.entries(value))]
      .map(([language, title]) => ({ language, title }));
    const titles = [...new Set(variants.map((variant) => variant.title))];
    if (titles.length === 0) throw new Error('MangaDex identity requires a title.');
    const blocked = attributes.contentRating === 'erotica' || attributes.contentRating === 'pornographic';
    const result: MutableCandidate = {
      canonicalUrl: `https://mangadex.org/title/${id}`, categories: blocked ? ['Adult'] : [],
      externalId: id, mediaKind: attributes.originalLanguage === 'ko' ? 'MANHWA' : attributes.originalLanguage.startsWith('zh') ? 'MANHUA' : 'MANGA',
      preSerialization: false, provider: 'mangadex', titles: titles.slice(0, 16), metadataVersion: 2,
      displayTitle: attributes.title.fr ?? attributes.title.en ?? attributes.title['ja-ro'] ?? titles[0],
      titleVariants: variants.slice(0, 16),
    };
    const fileName = response.value.data.relationships.find((relationship) => relationship.type === 'cover_art')?.attributes?.fileName;
    if (fileName !== undefined) result.cover = { attribution: 'MangaDex', url: `https://uploads.mangadex.org/covers/${id}/${encodeURIComponent(fileName)}.512.jpg` };
    const genres = [...new Set(attributes.tags.filter((tag) => tag.attributes.group === 'genre').flatMap((tag) => Object.values(tag.attributes.name)))].slice(0, 16);
    if (genres.length > 0) result.genres = genres;
    if (attributes.status !== undefined) result.editorialStatus = ({ ongoing: 'ONGOING', completed: 'COMPLETED', hiatus: 'HIATUS', cancelled: 'CANCELLED' } as const)[attributes.status];
    if (attributes.year != null) result.startYear = attributes.year;
    const linked = this.mangaUpdatesReference(attributes.links?.mu);
    if (linked !== undefined) result.linkedReferences = [linked];
    return createProviderCandidate(result, 'mangadex');
  }
}
