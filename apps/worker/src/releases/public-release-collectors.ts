import type { PublicReleaseEventContract } from '@tobirink/application';
import { publicReleaseEventSchema } from '@tobirink/application';
export interface PublicReleaseCollector { readonly provider: 'anilist' | 'mangaUpdates'; collect(window: { from: string; to: string }): Promise<readonly PublicReleaseEventContract[]>; }
export interface PublicReleaseD1Writer { batch(statements: readonly D1PreparedStatement[]): Promise<readonly D1Result[]>; prepare(query: string): D1PreparedStatement; }
export async function collectPublicReleaseLanes(collectors: readonly PublicReleaseCollector[], window: { from: string; to: string }): Promise<{ events: readonly PublicReleaseEventContract[]; failures: readonly string[] }> {
  const settled = await Promise.allSettled(collectors.map((collector) => collector.collect(window)));
  const events: PublicReleaseEventContract[] = []; const failures: string[] = [];
  settled.forEach((result, index) => { if (result.status === 'fulfilled') events.push(...result.value); else failures.push(collectors[index]?.provider ?? 'unknown'); });
  return { events: Object.freeze(events), failures: Object.freeze(failures) };
}
export function upsertPublicReleaseEvents(db: PublicReleaseD1Writer, events: readonly PublicReleaseEventContract[]): Promise<readonly D1Result[]> {
  const statements = events.map((event) => db.prepare('INSERT INTO public_release_event (id, provider, provider_work_id, release_kind, sequence_number, occurrence_kind, occurrence_value, state, source, fetched_at, parser_version, rules_version, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, occurrence_value=excluded.occurrence_value, fetched_at=excluded.fetched_at, expires_at=excluded.expires_at').bind(event.id, event.provider, event.providerWorkId, event.releaseKind, event.sequence ?? null, event.occurrence.kind, event.occurrence.value, event.state, event.provenance.source, event.provenance.fetchedAt, event.provenance.parserVersion, event.provenance.rulesVersion, event.expiresAt));
  return db.batch(statements);
}

export class AniListReleaseCollector implements PublicReleaseCollector {
  readonly provider = 'anilist' as const;
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async collect(window: { from: string; to: string }): Promise<readonly PublicReleaseEventContract[]> {
    const from = Math.floor(Date.parse(`${window.from}T00:00:00.000Z`) / 1000);
    const to = Math.floor(Date.parse(`${window.to}T23:59:59.999Z`) / 1000);
    const response = await this.fetcher('https://graphql.anilist.co', { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'query($from:Int!,$to:Int!){airingSchedule(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME,perPage:50){airingAt episode media{id}}}', variables: { from, to } }) });
    if (!response.ok) throw new Error(`anilist-${response.status}`);
    // SAFETY: AniList's envelope is narrowed by the guards below before any field is used.
    const body = await response.json() as { data?: { airingSchedule?: Array<{ airingAt?: number; episode?: number; media?: { id?: number } }> } };
    const fetchedAt = new Date().toISOString();
    const events = (body.data?.airingSchedule ?? []).flatMap((item) => {
      if (!Number.isSafeInteger(item.airingAt) || !Number.isSafeInteger(item.media?.id) || !Number.isSafeInteger(item.episode)) return [];
      return [publicReleaseEventSchema.parse({ id: `anilist-episode-${item.media!.id}-${item.episode}`, provider: 'anilist', providerWorkId: String(item.media!.id), releaseKind: 'episode', sequence: item.episode, occurrence: { kind: 'INSTANT', value: new Date(item.airingAt! * 1000).toISOString() }, state: 'SCHEDULED', provenance: { source: 'anilist', fetchedAt, parserVersion: '1', rulesVersion: '1' }, expiresAt: new Date((item.airingAt! + 60 * 86400) * 1000).toISOString() })];
    });
    return Object.freeze(events);
  }
}

export class MangaUpdatesReleaseCollector implements PublicReleaseCollector {
  readonly provider = 'mangaUpdates' as const;
  async collect(): Promise<readonly PublicReleaseEventContract[]> { return Object.freeze([]); }
}
