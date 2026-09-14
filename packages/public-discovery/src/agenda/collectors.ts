import { z } from 'zod';
import { publicAgendaReleaseEventSchema, type PublicAgendaReleaseEvent } from './contracts.js';
import { createMangaUpdatesAgendaEvent, parseAniListAgendaPage, parseMangaUpdatesAgendaPage } from './provider-pages.js';

const aniListPageLimit = 100;
const mangaUpdatesPageLimit = 250;
const anilistErrorSchema = z.object({ errors: z.array(z.object({ message: z.string().trim().min(1) }).passthrough()).max(1) }).passthrough();
type Wait = (milliseconds: number) => Promise<void>;
type SavePageCheckpoint = (checkpoint: PublicAgendaPageCheckpoint) => Promise<void>;
const wait: Wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const ignoreCheckpoint: SavePageCheckpoint = async () => undefined;

export interface PublicAgendaPageCheckpoint {
  readonly complete: boolean;
  readonly events: readonly PublicAgendaReleaseEvent[];
  readonly nextPage?: number;
  readonly notBefore?: number;
  readonly page: number;
  readonly provider: 'anilist' | 'mangaupdates';
}
export interface PublicAgendaCollector {
  readonly provider: 'anilist' | 'mangaupdates';
  collect(window: { from: string; to: string }): Promise<PublicAgendaProviderCollection>;
}
export interface PublicAgendaProviderCollection {
  readonly events: readonly PublicAgendaReleaseEvent[];
  readonly received: number;
  readonly skippedUnidentified: number;
}

export async function collectPublicAgendaLanes(collectors: readonly PublicAgendaCollector[], window: { from: string; to: string }): Promise<{ events: readonly PublicAgendaReleaseEvent[]; failures: readonly string[]; quality: Readonly<Record<'anilist' | 'mangaupdates', { accepted: number; received: number; skippedUnidentified: number }>> }> {
  const settled = await Promise.allSettled(collectors.map((collector) => collector.collect(window)));
  const events: PublicAgendaReleaseEvent[] = []; const failures: string[] = [];
  const quality = { anilist: { accepted: 0, received: 0, skippedUnidentified: 0 }, mangaupdates: { accepted: 0, received: 0, skippedUnidentified: 0 } };
  settled.forEach((result, index) => {
    const provider = collectors[index]?.provider ?? 'anilist';
    if (result.status === 'fulfilled') {
      events.push(...result.value.events);
      quality[provider] = { accepted: result.value.events.length, received: result.value.received, skippedUnidentified: result.value.skippedUnidentified };
    }
    else failures.push(`${collectors[index]?.provider ?? 'unknown'}:${result.reason instanceof Error ? result.reason.message.slice(0, 64) : 'unknown-error'}`);
  });
  return { events: Object.freeze(events), failures: Object.freeze(failures), quality: Object.freeze(quality) };
}

export class AniListAgendaCollector implements PublicAgendaCollector {
  readonly provider = 'anilist' as const;
  private readonly fetcher: typeof fetch;
  constructor(fetcher?: typeof fetch, private readonly pause: Wait = wait, private readonly saveCheckpoint: SavePageCheckpoint = ignoreCheckpoint, private readonly clock: () => number = Date.now) { this.fetcher = fetcher ?? fetch.bind(globalThis); }
  async collect(window: { from: string; to: string }): Promise<PublicAgendaProviderCollection> {
    const from = Math.floor(Date.parse(`${window.from}T00:00:00.000Z`) / 1000);
    const to = Math.floor(Date.parse(`${window.to}T23:59:59.999Z`) / 1000);
    const events = new Map<string, PublicAgendaReleaseEvent>();
    let received = 0;
    for (let page = 1; page <= aniListPageLimit; page += 1) {
      const response = await this.fetcher('https://graphql.anilist.co', {
        method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Origin: 'https://tobirink.com', Referer: 'https://tobirink.com/', 'User-Agent': 'TobiRink/1.0 (+https://tobirink.com)' },
        body: JSON.stringify({ query: 'query($page:Int!,$from:Int!,$to:Int!){Page(page:$page,perPage:50){pageInfo{hasNextPage}airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME){airingAt episode media{id}}}}', variables: { from, page, to } }), signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        const text = (await response.text()).slice(0, 512);
        let message = text.replace(/\s+/gu, ' ').trim();
        try { const parsed = anilistErrorSchema.safeParse(JSON.parse(text)); const upstream = parsed.success ? parsed.data.errors[0]?.message : undefined; if (upstream !== undefined) message = upstream.slice(0, 384); }
        catch { /* retain bounded upstream text */ }
        throw new Error(`anilist-${response.status}${message ? `:${message}` : ''}`);
      }
      const body = await parseAniListAgendaPage(response);
      received += body.data.Page.airingSchedules.length;
      const fetchedAt = new Date().toISOString();
      const pageEvents = body.data.Page.airingSchedules.map((item) => publicAgendaReleaseEventSchema.parse({
        id: `anilist-episode-${item.media.id}-${item.episode}`, provider: 'anilist', providerWorkId: String(item.media.id), releaseKind: 'episode', sequence: item.episode,
        occurrence: { kind: 'INSTANT', value: new Date(item.airingAt * 1000).toISOString() }, state: 'SCHEDULED', provenance: { source: 'anilist', fetchedAt, parserVersion: '2', rulesVersion: '2' }, expiresAt: new Date((item.airingAt + 60 * 86400) * 1000).toISOString(),
      }));
      for (const event of pageEvents) events.set(event.id, event);
      const hasNextPage = body.data.Page.pageInfo.hasNextPage;
      await this.saveCheckpoint(hasNextPage ? { complete: false, events: Object.freeze(pageEvents), nextPage: page + 1, notBefore: this.clock() + 2_200, page, provider: this.provider } : { complete: true, events: Object.freeze(pageEvents), page, provider: this.provider });
      if (!hasNextPage) return { events: Object.freeze([...events.values()]), received, skippedUnidentified: 0 };
      if (page === aniListPageLimit) throw new Error('anilist-pagination-limit');
      await this.pause(2_200);
    }
    throw new Error('anilist-pagination-incomplete');
  }
}

export class MangaUpdatesAgendaCollector implements PublicAgendaCollector {
  readonly provider = 'mangaupdates' as const;
  constructor(private readonly fetcher: typeof fetch = fetch.bind(globalThis), private readonly pause: Wait = wait, private readonly saveCheckpoint: SavePageCheckpoint = ignoreCheckpoint, private readonly clock: () => number = Date.now) {}
  async collect(window: { from: string; to: string }): Promise<PublicAgendaProviderCollection> {
    const events = new Map<string, PublicAgendaReleaseEvent>();
    let received = 0; let skippedUnidentified = 0;
    for (let requestedPage = 1; requestedPage <= mangaUpdatesPageLimit; requestedPage += 1) {
      const response = await this.fetcher('https://api.mangaupdates.com/v1/releases/search', { body: JSON.stringify({ end_date: window.to, include_metadata: true, page: requestedPage, perpage: 40, start_date: window.from }), headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'TobiRink/1.0 (+https://tobirink.com)' }, method: 'POST', signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`mangaupdates-${response.status}`);
      const body = await parseMangaUpdatesAgendaPage(response);
      received += body.results.length;
      if (body.page !== requestedPage) throw new Error('mangaupdates-page-mismatch');
      if (body.results.length === 0 && events.size < body.total_hits) throw new Error('mangaupdates-pagination-incomplete');
      const fetchedAt = new Date().toISOString();
      const pageEvents: PublicAgendaReleaseEvent[] = [];
      for (const item of body.results) {
        try { pageEvents.push(createMangaUpdatesAgendaEvent(item, fetchedAt)); }
        catch (error) { if (!(error instanceof Error) || error.message !== 'mangaupdates-series-id-missing') throw error; skippedUnidentified += 1; }
      }
      for (const event of pageEvents) events.set(event.id, event);
      const hasNextPage = body.page * body.per_page < body.total_hits;
      await this.saveCheckpoint(hasNextPage ? { complete: false, events: Object.freeze(pageEvents), nextPage: body.page + 1, notBefore: this.clock() + 3_000, page: body.page, provider: this.provider } : { complete: true, events: Object.freeze(pageEvents), page: body.page, provider: this.provider });
      if (!hasNextPage) {
        if (received > 0 && skippedUnidentified / received > 0.05) throw new Error(`mangaupdates-unidentified-ratio:${skippedUnidentified}/${received}`);
        return { events: Object.freeze([...events.values()]), received, skippedUnidentified };
      }
      if (requestedPage === mangaUpdatesPageLimit) throw new Error('mangaupdates-pagination-limit');
      await this.pause(3_000);
    }
    throw new Error('mangaupdates-pagination-incomplete');
  }
}
