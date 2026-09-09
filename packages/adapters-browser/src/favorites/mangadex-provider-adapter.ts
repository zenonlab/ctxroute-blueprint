import { favoriteProviderPolicy } from '@tobirink/application';
import type { FavoriteProviderHydrationPort, FavoriteProviderReference, FavoriteSourceAdapter } from '@tobirink/application';
import { createSourceEvidence } from '@tobirink/domain';
import type { ProviderCandidate } from '@tobirink/domain';
import { z } from 'zod';
import { FavoriteProviderRateGate, readFavoriteProviderIdentityJson } from './provider-http';
import type { FavoriteProviderFetch } from './provider-http';

type MutableCandidate = { -readonly [Key in keyof ProviderCandidate]: ProviderCandidate[Key] };

const uuid = z.uuid();
const titleMap = z.record(z.string().max(16), z.string().min(1).max(1024)).refine((value) => Object.keys(value).length <= 64);
const hydrationSchema = z.object({
  result: z.literal('ok'),
  data: z.object({
    id: uuid, type: z.literal('manga'),
    attributes: z.object({
      title: titleMap, altTitles: z.array(titleMap).max(128), contentRating: z.enum(['safe', 'suggestive', 'erotica', 'pornographic']), originalLanguage: z.string().min(2).max(16),
      status: z.enum(['ongoing', 'completed', 'hiatus', 'cancelled']).optional(), year: z.number().int().min(1800).max(3000).nullable().optional(),
      lastChapter: z.string().nullable().optional(), lastVolume: z.string().nullable().optional(),
      tags: z.array(z.object({ attributes: z.object({ name: titleMap }).passthrough() }).passthrough()).max(32).optional().default([]),
    }).passthrough(),
  }),
});

export const mangaDexSourceAdapter: FavoriteSourceAdapter = {
  id: 'mangadex-url-v1', origins: ['https://mangadex.org', 'https://www.mangadex.org'],
  analyze(input, url) {
    const [route, rawId] = url.decodedSegments;
    const parsed = uuid.safeParse(rawId);
    if (route !== 'title' || !parsed.success || url.decodedSegments.length > 3) return undefined;
    const id = parsed.data.toLowerCase();
    return createSourceEvidence({
      aliases: [], canonicalUrl: `${url.origin}/title/${id}`, diagnostics: [],
      explicitProviderReference: { externalId: id, provider: 'mangadex' }, key: input.sourceKey,
      mediaKind: 'MANGA', origin: url.origin, path: url.pathname, proofs: ['CATEGORY_PATH'],
      sourceAdapter: 'mangadex-url-v1', strategy: 'exact-origin',
    });
  },
};

export class MangaDexFavoriteProviderAdapter implements FavoriteProviderHydrationPort {
  constructor(private readonly fetcher: FavoriteProviderFetch = fetch, private readonly gate = new FavoriteProviderRateGate('mangadex')) {}

  async hydrate(reference: FavoriteProviderReference): Promise<ProviderCandidate | undefined> {
    if (reference.provider !== 'mangadex') throw new TypeError('MangaDex hydration requires a MangaDex reference.');
    const id = uuid.parse(reference.externalId).toLowerCase();
    const response = await this.gate.run(favoriteProviderPolicy.mangadex.minimumIntervalMs, () => readFavoriteProviderIdentityJson(this.fetcher, `https://api.mangadex.org/manga/${id}`, { headers: { Accept: 'application/json' }, method: 'GET' }, hydrationSchema));
    if (response === undefined) return undefined;
    if (response.value.data.id.toLowerCase() !== id) throw new Error('MangaDex hydration returned a different identity.');
    const attributes = response.value.data.attributes;
    const titles = [...new Set([...Object.values(attributes.title), ...attributes.altTitles.flatMap((value) => Object.values(value))])];
    if (titles.length === 0) throw new Error('MangaDex identity requires a title.');
    const blocked = attributes.contentRating === 'erotica' || attributes.contentRating === 'pornographic';
    const result: MutableCandidate = {
      canonicalUrl: `https://mangadex.org/title/${id}`, categories: blocked ? ['Adult'] : [],
      externalId: id, mediaKind: attributes.originalLanguage === 'ko' ? 'MANHWA' : attributes.originalLanguage.startsWith('zh') ? 'MANHUA' : 'MANGA',
      preSerialization: false, provider: 'mangadex', titles: titles.slice(0, 16), metadataVersion: 1,
    };
    const genres = [...new Set(attributes.tags.flatMap((tag) => Object.values(tag.attributes.name)))].slice(0, 16);
    if (genres.length > 0) result.genres = genres;
    if (attributes.status !== undefined) result.editorialStatus = ({ ongoing: 'ONGOING', completed: 'COMPLETED', hiatus: 'HIATUS', cancelled: 'CANCELLED' } as const)[attributes.status];
    if (attributes.year != null) result.startYear = attributes.year;
    const chapters = Number(attributes.lastChapter); const volumes = Number(attributes.lastVolume);
    if (Number.isSafeInteger(chapters) && chapters >= 0) result.chapterCount = chapters;
    if (Number.isSafeInteger(volumes) && volumes >= 0) result.volumeCount = volumes;
    return result;
  }
}
