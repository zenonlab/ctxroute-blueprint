import type { PublicReleaseEventContract } from '@tobirink/application';

export {
  AniListAgendaCollector as AniListReleaseCollector,
  collectPublicAgendaLanes as collectPublicReleaseLanes,
  MangaUpdatesAgendaCollector as MangaUpdatesReleaseCollector,
} from '@tobirink/public-discovery/agenda';
export type {
  PublicAgendaCollector as PublicReleaseCollector,
  PublicAgendaPageCheckpoint as PublicReleasePageCheckpoint,
} from '@tobirink/public-discovery/agenda';

export interface PublicReleaseD1Writer { batch(statements: readonly D1PreparedStatement[]): Promise<readonly D1Result[]>; prepare(query: string): D1PreparedStatement; }
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
  results.push(...await db.batch([db.prepare("INSERT OR IGNORE INTO public_release_generation (revision, status, generated_at, window_from, window_to, event_count) VALUES (?1, 'staging', ?2, ?3, ?4, ?5)").bind(revision, generatedAt, window.from, window.to, events.length)]));
  for (let offset = 0; offset < events.length; offset += 50) {
    const statements = events.slice(offset, offset + 50).map((event) => db.prepare('INSERT OR IGNORE INTO public_release_generation_event (generation_revision, id, provider, provider_work_id, release_kind, sequence_label, occurrence_kind, occurrence_value, state, source, fetched_at, parser_version, rules_version, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)').bind(revision, event.id, event.provider, event.providerWorkId, event.releaseKind, event.sequence ?? null, event.occurrence.kind, event.occurrence.value, event.state, event.provenance.source, event.provenance.fetchedAt, event.provenance.parserVersion, event.provenance.rulesVersion, event.expiresAt));
    results.push(...await db.batch(statements));
  }
  results.push(...await db.batch([
    db.prepare("UPDATE public_release_generation SET status = 'staging' WHERE status = 'active' AND revision <> ?1 AND generated_at <= ?2 AND EXISTS (SELECT 1 FROM public_release_generation AS candidate WHERE candidate.revision = ?1 AND candidate.event_count = (SELECT COUNT(*) FROM public_release_generation_event WHERE generation_revision = ?1))").bind(revision, generatedAt),
    db.prepare("UPDATE public_release_generation SET status = 'active' WHERE revision = ?1 AND event_count = (SELECT COUNT(*) FROM public_release_generation_event WHERE generation_revision = ?1) AND NOT EXISTS (SELECT 1 FROM public_release_active_generation AS pointer JOIN public_release_generation AS current ON current.revision = pointer.revision WHERE pointer.id = 'active' AND current.generated_at > ?2)").bind(revision, generatedAt),
    db.prepare("INSERT INTO public_release_active_generation (id, revision) SELECT 'active', ?1 WHERE EXISTS (SELECT 1 FROM public_release_generation AS candidate WHERE candidate.revision = ?1 AND candidate.event_count = (SELECT COUNT(*) FROM public_release_generation_event WHERE generation_revision = ?1)) AND NOT EXISTS (SELECT 1 FROM public_release_active_generation AS pointer JOIN public_release_generation AS current ON current.revision = pointer.revision WHERE pointer.id = 'active' AND current.generated_at > ?2) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision").bind(revision, generatedAt),
  ]));
  return results;
}
