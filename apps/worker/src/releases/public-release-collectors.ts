import type { PublicReleaseEventContract } from '@tobirink/application';
import { publicReleaseEventSchema } from '@tobirink/application';
import { z } from 'zod';
const aniListPageLimit = 100;
const mangaUpdatesPageLimit = 250;
const anilistErrorSchema = z.object({ errors: z.array(z.object({ message: z.string().trim().min(1) }).passthrough()).max(1) }).passthrough();
import { createMangaUpdatesReleaseEvent, parseAniListReleasePage, parseMangaUpdatesReleasePage } from './provider-release-responses';
type Wait = (milliseconds: number) => Promise<void>;
export interface PublicReleasePageCheckpoint { readonly complete: boolean; readonly events: readonly PublicReleaseEventContract[]; readonly nextPage?: number; readonly notBefore?: number; readonly page: number; readonly provider: 'anilist' | 'mangaupdates' }
type SavePageCheckpoint = (checkpoint: PublicReleasePageCheckpoint) => Promise<void>;
const wait: Wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const ignoreCheckpoint: SavePageCheckpoint = async () => undefined;
export interface PublicReleaseCollector { readonly provider: 'anilist' | 'mangaupdates'; collect(window: { from: string; to: string }): Promise<readonly PublicReleaseEventContract[]>; }
export interface PublicReleaseD1Writer { batch(statements: readonly D1PreparedStatement[]): Promise<readonly D1Result[]>; prepare(query: string): D1PreparedStatement; }
export async function collectPublicReleaseLanes(collectors: readonly PublicReleaseCollector[], window: { from: string; to: string }): Promise<{ events: readonly PublicReleaseEventContract[]; failures: readonly string[] }> {
  const settled = await Promise.allSettled(collectors.map((collector) => collector.collect(window)));
  const events: PublicReleaseEventContract[] = []; const failures: string[] = [];
  settled.forEach((result, index) => { if (result.status === 'fulfilled') events.push(...result.value); else failures.push(`${collectors[index]?.provider ?? 'unknown'}:${result.reason instanceof Error ? result.reason.message.slice(0, 64) : 'unknown-error'}`); });
  return { events: Object.freeze(events), failures: Object.freeze(failures) };
}
function publicReleaseUpsertStatements(db: PublicReleaseD1Writer, events: readonly PublicReleaseEventContract[]): readonly D1PreparedStatement[] {
  return events.map((event) => {
    const legacyProvider = event.provider === 'mangaupdates' ? 'mangaUpdates' : event.provider;
    return db.prepare('INSERT INTO public_release_event (id, provider, provider_key, provider_work_id, release_kind, sequence_number, sequence_label, occurrence_kind, occurrence_value, state, source, fetched_at, parser_version, rules_version, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET provider_key=excluded.provider_key, sequence_label=excluded.sequence_label, state=excluded.state, occurrence_value=excluded.occurrence_value, fetched_at=excluded.fetched_at, expires_at=excluded.expires_at').bind(event.id, legacyProvider, event.provider, event.providerWorkId, event.releaseKind, null, event.sequence ?? null, event.occurrence.kind, event.occurrence.value, event.state, event.provenance.source, event.provenance.fetchedAt, event.provenance.parserVersion, event.provenance.rulesVersion, event.expiresAt);
  });
}
export function upsertPublicReleaseEvents(db: PublicReleaseD1Writer, events: readonly PublicReleaseEventContract[]): Promise<readonly D1Result[]> {
  return db.batch(publicReleaseUpsertStatements(db, events));
}
export async function commitPublicReleaseGeneration(db: PublicReleaseD1Writer, events: readonly PublicReleaseEventContract[], window: { from: string; to: string }, revision: string, generatedAt: string): Promise<readonly D1Result[]> {
  const results: D1Result[] = [];
  results.push(...await db.batch([db.prepare("INSERT INTO public_release_generation (revision, status, generated_at, window_from, window_to, event_count) VALUES (?1, 'staging', ?2, ?3, ?4, ?5)").bind(revision, generatedAt, window.from, window.to, events.length)]));
  for (let offset = 0; offset < events.length; offset += 50) {
    const statements = events.slice(offset, offset + 50).map((event) => db.prepare('INSERT INTO public_release_generation_event (generation_revision, id, provider, provider_work_id, release_kind, sequence_label, occurrence_kind, occurrence_value, state, source, fetched_at, parser_version, rules_version, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)').bind(revision, event.id, event.provider, event.providerWorkId, event.releaseKind, event.sequence ?? null, event.occurrence.kind, event.occurrence.value, event.state, event.provenance.source, event.provenance.fetchedAt, event.provenance.parserVersion, event.provenance.rulesVersion, event.expiresAt));
    results.push(...await db.batch(statements));
  }
  results.push(...await db.batch([
    db.prepare("UPDATE public_release_generation SET status = 'staging' WHERE status = 'active' AND EXISTS (SELECT 1 FROM public_release_generation AS candidate WHERE candidate.revision = ?1 AND candidate.event_count = (SELECT COUNT(*) FROM public_release_generation_event WHERE generation_revision = ?1))").bind(revision),
    db.prepare("UPDATE public_release_generation SET status = 'active' WHERE revision = ?1 AND EXISTS (SELECT 1 FROM public_release_generation AS candidate WHERE candidate.revision = ?1 AND candidate.event_count = (SELECT COUNT(*) FROM public_release_generation_event WHERE generation_revision = ?1))").bind(revision),
    db.prepare("INSERT INTO public_release_active_generation (id, revision) SELECT 'active', ?1 WHERE EXISTS (SELECT 1 FROM public_release_generation AS candidate WHERE candidate.revision = ?1 AND candidate.event_count = (SELECT COUNT(*) FROM public_release_generation_event WHERE generation_revision = ?1)) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision").bind(revision),
  ]));
  return results;
}

export class AniListReleaseCollector implements PublicReleaseCollector {
  readonly provider = 'anilist' as const;
  constructor(fetcher?: typeof fetch, private readonly pause: Wait = wait, private readonly saveCheckpoint: SavePageCheckpoint = ignoreCheckpoint, private readonly clock: () => number = Date.now) { this.fetcher = fetcher ?? fetch.bind(globalThis); }
  private readonly fetcher: typeof fetch;
  async collect(window: { from: string; to: string }): Promise<readonly PublicReleaseEventContract[]> {
    const from = Math.floor(Date.parse(`${window.from}T00:00:00.000Z`) / 1000);
    const to = Math.floor(Date.parse(`${window.to}T23:59:59.999Z`) / 1000);
    const events = new Map<string, PublicReleaseEventContract>();
    for (let page = 1; page <= aniListPageLimit; page += 1) {
      const response = await this.fetcher('https://graphql.anilist.co', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json', Origin: 'https://tobirink.com', Referer: 'https://tobirink.com/', 'User-Agent': 'TobiRink/1.0 (+https://tobirink.com)' }, body: JSON.stringify({ query: 'query($page:Int!,$from:Int!,$to:Int!){Page(page:$page,perPage:50){pageInfo{hasNextPage}airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME){airingAt episode media{id}}}}', variables: { from, page, to } }), signal: AbortSignal.timeout(8_000) });
      if (!response.ok) {
        const text = (await response.text()).slice(0, 512);
        let message = text.replace(/\s+/gu, ' ').trim();
        try {
          const parsed = anilistErrorSchema.safeParse(JSON.parse(text));
          const upstream = parsed.success ? parsed.data.errors[0]?.message : undefined;
          if (upstream !== undefined) message = upstream.slice(0, 384);
        } catch { /* retain bounded raw text for non-JSON upstream errors */ }
        throw new Error(`anilist-${response.status}${message ? `:${message}` : ''}`);
      }
      const body = await parseAniListReleasePage(response);
      const fetchedAt = new Date().toISOString();
      const pageEvents: PublicReleaseEventContract[] = [];
      for (const item of body.data.Page.airingSchedules) {
        const event = publicReleaseEventSchema.parse({ id: `anilist-episode-${item.media.id}-${item.episode}`, provider: 'anilist', providerWorkId: String(item.media.id), releaseKind: 'episode', sequence: item.episode, occurrence: { kind: 'INSTANT', value: new Date(item.airingAt * 1000).toISOString() }, state: 'SCHEDULED', provenance: { source: 'anilist', fetchedAt, parserVersion: '2', rulesVersion: '2' }, expiresAt: new Date((item.airingAt + 60 * 86400) * 1000).toISOString() });
        events.set(event.id, event); pageEvents.push(event);
      }
      const hasNextPage = body.data.Page.pageInfo.hasNextPage;
      await this.saveCheckpoint(hasNextPage ? { complete: false, events: Object.freeze(pageEvents), nextPage: page + 1, notBefore: this.clock() + 2_200, page, provider: this.provider } : { complete: true, events: Object.freeze(pageEvents), page, provider: this.provider });
      if (!hasNextPage) return Object.freeze([...events.values()]);
      if (page === aniListPageLimit) throw new Error('anilist-pagination-limit');
      await this.pause(2_200);
    }
    throw new Error('anilist-pagination-incomplete');
  }
}

export class MangaUpdatesReleaseCollector implements PublicReleaseCollector {
  readonly provider = 'mangaupdates' as const;
  constructor(private readonly fetcher: typeof fetch = fetch.bind(globalThis), private readonly pause: Wait = wait, private readonly saveCheckpoint: SavePageCheckpoint = ignoreCheckpoint, private readonly clock: () => number = Date.now) {}
  async collect(window: { from: string; to: string }): Promise<readonly PublicReleaseEventContract[]> {
    const events = new Map<string, PublicReleaseEventContract>();
    for (let requestedPage = 1; requestedPage <= mangaUpdatesPageLimit; requestedPage += 1) {
      const response = await this.fetcher('https://api.mangaupdates.com/v1/releases/search', { body: JSON.stringify({ end_date: window.to, include_metadata: true, page: requestedPage, perpage: 40, start_date: window.from }), headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'TobiRink/1.0 (+https://tobirink.com)' }, method: 'POST', signal: AbortSignal.timeout(8_000) });
      if (!response.ok) throw new Error(`mangaupdates-${response.status}`);
      const body = await parseMangaUpdatesReleasePage(response);
      if (body.page !== requestedPage) throw new Error('mangaupdates-page-mismatch');
      if (body.results.length === 0 && events.size < body.total_hits) throw new Error('mangaupdates-pagination-incomplete');
      const fetchedAt = new Date().toISOString();
      const pageEvents: PublicReleaseEventContract[] = [];
      for (const item of body.results) { const event = createMangaUpdatesReleaseEvent(item, fetchedAt); events.set(event.id, event); pageEvents.push(event); }
      const hasNextPage = body.page * body.per_page < body.total_hits;
      await this.saveCheckpoint(hasNextPage ? { complete: false, events: Object.freeze(pageEvents), nextPage: body.page + 1, notBefore: this.clock() + 3_000, page: body.page, provider: this.provider } : { complete: true, events: Object.freeze(pageEvents), page: body.page, provider: this.provider });
      if (!hasNextPage) return Object.freeze([...events.values()]);
      if (requestedPage === mangaUpdatesPageLimit) throw new Error('mangaupdates-pagination-limit');
      await this.pause(3_000);
    }
    throw new Error('mangaupdates-pagination-incomplete');
  }
}
