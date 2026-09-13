import type { PublicReleaseEventContract } from '@tobirink/application';
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
