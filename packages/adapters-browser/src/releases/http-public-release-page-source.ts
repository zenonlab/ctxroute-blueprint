import { z } from 'zod';
import { aniListReleasePageSchema, createMangaUpdatesReleaseEvent, mangaUpdatesReleasePageSchema, publicReleaseEventSchema, publicReleasePageCheckpointSchema } from '@tobirink/application';
import type { PublicReleasePageCheckpoint, PublicReleasePageSource } from '@tobirink/application';

const responseByteLimit = 1_000_000;
export interface PublicReleaseProviderFetch { (input: RequestInfo | URL, init?: RequestInit): Promise<Response> }

async function readText(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`public-release-provider-${response.status}`);
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > responseByteLimit) throw new Error('public-release-provider-response-too-large');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > responseByteLimit) throw new Error('public-release-provider-response-too-large');
  return text;
}

const jsonSchema = z.json();
function parseJson(text: string): z.output<typeof jsonSchema> {
  try { return jsonSchema.parse(JSON.parse(text)); } catch { throw new Error('public-release-provider-json-invalid'); }
}

export class HttpPublicReleasePageSource implements PublicReleasePageSource {
  constructor(private readonly fetcher: PublicReleaseProviderFetch = fetch.bind(globalThis), private readonly clock: () => number = Date.now) {}

  async collectPage(provider: 'anilist' | 'mangaupdates', page: number, window: { from: string; to: string }): Promise<PublicReleasePageCheckpoint> {
    return provider === 'anilist' ? this.collectAniList(page, window) : this.collectMangaUpdates(page, window);
  }

  private async collectAniList(page: number, window: { from: string; to: string }): Promise<PublicReleasePageCheckpoint> {
    if (page > 100) throw new Error('anilist-pagination-limit');
    const from = Math.floor(Date.parse(`${window.from}T00:00:00.000Z`) / 1000);
    const to = Math.floor(Date.parse(`${window.to}T23:59:59.999Z`) / 1000);
    const response = await this.fetcher('https://graphql.anilist.co', { body: JSON.stringify({ query: 'query($page:Int!,$from:Int!,$to:Int!){Page(page:$page,perPage:50){pageInfo{hasNextPage}airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME){airingAt episode media{id}}}}', variables: { from, page, to } }), headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, method: 'POST', signal: AbortSignal.timeout(8_000) });
    const body = aniListReleasePageSchema.parse(parseJson(await readText(response)));
    const fetchedAt = new Date(this.clock()).toISOString();
    const events = body.data.Page.airingSchedules.map((item) => publicReleaseEventSchema.parse({ expiresAt: new Date((item.airingAt + 60 * 86_400) * 1000).toISOString(), id: `anilist-episode-${item.media.id}-${item.episode}`, occurrence: { kind: 'INSTANT', value: new Date(item.airingAt * 1000).toISOString() }, provenance: { fetchedAt, parserVersion: '2', rulesVersion: '2', source: 'anilist' }, provider: 'anilist', providerWorkId: String(item.media.id), releaseKind: 'episode', sequence: item.episode, state: 'SCHEDULED' }));
    return publicReleasePageCheckpointSchema.parse(body.data.Page.pageInfo.hasNextPage ? { complete: false, events, nextPage: page + 1, notBefore: this.clock() + 2_200, page, provider: 'anilist' } : { complete: true, events, page, provider: 'anilist' });
  }

  private async collectMangaUpdates(page: number, window: { from: string; to: string }): Promise<PublicReleasePageCheckpoint> {
    if (page > 250) throw new Error('mangaupdates-pagination-limit');
    const response = await this.fetcher('https://api.mangaupdates.com/v1/releases/search', { body: JSON.stringify({ end_date: window.to, include_metadata: true, page, perpage: 40, start_date: window.from }), headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, method: 'POST', signal: AbortSignal.timeout(8_000) });
    const body = mangaUpdatesReleasePageSchema.parse(parseJson(await readText(response)));
    if (body.page !== page) throw new Error('mangaupdates-page-mismatch');
    const fetchedAt = new Date(this.clock()).toISOString();
    const events = body.results.map((item) => createMangaUpdatesReleaseEvent(item, fetchedAt));
    const hasNextPage = body.page * body.per_page < body.total_hits;
    if (events.length === 0 && hasNextPage) throw new Error('mangaupdates-pagination-incomplete');
    return publicReleasePageCheckpointSchema.parse(hasNextPage ? { complete: false, events, nextPage: page + 1, notBefore: this.clock() + 3_000, page, provider: 'mangaupdates' } : { complete: true, events, page, provider: 'mangaupdates' });
  }
}
