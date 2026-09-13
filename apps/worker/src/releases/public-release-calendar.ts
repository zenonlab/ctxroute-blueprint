import type { PublicReleaseEventContract } from '@tobirink/application';
import { publicReleaseEventSchema } from '@tobirink/application';
import { collectPublicReleaseLanes, upsertPublicReleaseEvents, AniListReleaseCollector, MangaUpdatesReleaseCollector } from './public-release-collectors';

export interface PublicReleaseQuery { from?: string; to?: string; cursor?: string; limit: number }
export interface PublicReleaseCalendarPort {
  query(input: PublicReleaseQuery): Promise<{ entries: readonly PublicReleaseEventContract[]; revision: string; generatedAt: string; nextCursor?: string }>;
  sync(window: { from: string; to: string }): Promise<{ count: number; failures: readonly string[] }>;
}
interface CalendarPage { entries: readonly PublicReleaseEventContract[]; revision: string; generatedAt: string; nextCursor?: string }
interface ReleaseRow { id: string; provider: string; provider_key: string | null; provider_work_id: string; release_kind: string; sequence_number: number | null; sequence_label: string | null; occurrence_kind: string; occurrence_value: string; state: string; source: string; fetched_at: string; parser_version: string; rules_version: string; expires_at: string }

export class D1PublicReleaseCalendarAdapter implements PublicReleaseCalendarPort {
  constructor(private readonly db: D1Database) {}
  async query(input: { from?: string; to?: string; cursor?: string; limit: number }) {
    const rows = await this.db.prepare('SELECT id, provider, provider_key, provider_work_id, release_kind, sequence_number, sequence_label, occurrence_kind, occurrence_value, state, source, fetched_at, parser_version, rules_version, expires_at FROM public_release_event WHERE (?1 IS NULL OR occurrence_value >= ?1) AND (?2 IS NULL OR occurrence_value <= ?2) AND (?3 IS NULL OR id > ?3) ORDER BY id LIMIT ?4').bind(input.from ?? null, input.to ? `${input.to}T23:59:59.999Z` : null, input.cursor ?? null, input.limit + 1).all<ReleaseRow>();
    const parsed = rows.results.flatMap((row) => { try { return [publicReleaseEventSchema.parse({ id: row.id, provider: row.provider_key ?? row.provider, providerWorkId: row.provider_work_id, releaseKind: row.release_kind, sequence: row.sequence_label ?? row.sequence_number ?? undefined, occurrence: { kind: row.occurrence_kind, value: row.occurrence_value }, state: row.state, provenance: { source: row.source, fetchedAt: row.fetched_at, parserVersion: row.parser_version, rulesVersion: row.rules_version }, expiresAt: row.expires_at })]; } catch { return []; } });
    const entries = parsed.slice(0, input.limit);
    const nextCursor = parsed.length > input.limit ? entries.at(-1)?.id : undefined;
    const page: CalendarPage = { entries: Object.freeze(entries), revision: `d1-${rows.results.length}`, generatedAt: new Date().toISOString() };
    if (nextCursor) page.nextCursor = nextCursor;
    return page;
  }
  async sync(window: { from: string; to: string }) {
    const result = await collectPublicReleaseLanes([new AniListReleaseCollector(), new MangaUpdatesReleaseCollector()], window);
    if (result.events.length > 0) await upsertPublicReleaseEvents(this.db, result.events);
    return { count: result.events.length, failures: result.failures };
  }
}
