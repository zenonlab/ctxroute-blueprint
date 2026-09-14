import type { PublicReleaseEventContract } from '@tobirink/application';
import { publicReleaseEventSchema } from '@tobirink/application';
import { commitPublicReleaseGeneration } from './public-release-collectors';
import type { PublicReleaseIngestion } from './public-release-ingestion';

export interface PublicReleaseQuery { from?: string; to?: string; cursor?: string; limit: number }
export interface PublicReleaseCalendarPort {
  ingest(input: PublicReleaseIngestion): Promise<{ accepted: boolean; count: number; replayed: boolean; revision: string }>;
  query(input: PublicReleaseQuery): Promise<{ entries: readonly PublicReleaseEventContract[]; revision: string; generatedAt: string; nextCursor?: string }>;
}
interface CalendarPage { entries: readonly PublicReleaseEventContract[]; revision: string; generatedAt: string; nextCursor?: string }
interface ReleaseRow { id: string; provider: string; provider_work_id: string; release_kind: string; sequence_label: string | null; occurrence_kind: string; occurrence_value: string; state: string; source: string; fetched_at: string; parser_version: string; rules_version: string; expires_at: string }
interface ReleaseGenerationRow { revision: string; generated_at: string }
interface ReleaseCursor { id: string | null; occurrence: string | null }
function decodeCursor(cursor: string | undefined): ReleaseCursor {
  if (cursor === undefined) return { id: null, occurrence: null };
  const separator = cursor.indexOf('|');
  if (separator < 10 || separator === cursor.length - 1 || cursor.length > 256) throw new Error('invalid-release-cursor');
  return { occurrence: cursor.slice(0, separator), id: cursor.slice(separator + 1) };
}

export class D1PublicReleaseCalendarAdapter implements PublicReleaseCalendarPort {
  constructor(private readonly db: D1Database) {}
  async ingest(input: PublicReleaseIngestion) {
    const events = [...input.events].sort((left, right) => left.id.localeCompare(right.id));
    const digestInput = JSON.stringify({ events, generatedAt: input.generatedAt, schemaVersion: input.schemaVersion, window: input.window });
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(digestInput))), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const revision = `calendar-${digest.slice(0, 48)}`;
    const previous = await this.db.prepare("SELECT revision FROM public_release_active_generation WHERE id = 'active'").first<{ revision: string }>();
    await commitPublicReleaseGeneration(this.db, events, input.window, revision, input.generatedAt);
    const active = await this.db.prepare("SELECT revision FROM public_release_active_generation WHERE id = 'active'").first<{ revision: string }>();
    return { accepted: active?.revision === revision, count: events.length, replayed: previous?.revision === revision, revision };
  }
  async query(input: { from?: string; to?: string; cursor?: string; limit: number }) {
    const cursor = decodeCursor(input.cursor);
    const lowerBound = input.from ?? '0000-01-01';
    const upperBound = input.to ? `${input.to}T23:59:59.999Z` : '9999-12-31T23:59:59.999Z';
    const rows = await this.db.prepare("SELECT event.id, event.provider, event.provider_work_id, event.release_kind, event.sequence_label, event.occurrence_kind, event.occurrence_value, event.state, event.source, event.fetched_at, event.parser_version, event.rules_version, event.expires_at FROM public_release_generation_event AS event JOIN public_release_active_generation AS active ON active.revision = event.generation_revision AND active.id = 'active' WHERE event.occurrence_value >= ?1 AND event.occurrence_value <= ?2 AND (event.occurrence_value > ?3 OR (event.occurrence_value = ?3 AND event.id > ?4)) ORDER BY event.occurrence_value, event.id LIMIT ?5").bind(lowerBound, upperBound, cursor.occurrence ?? lowerBound, cursor.id ?? '', input.limit + 1).all<ReleaseRow>();
    const generation = await this.db.prepare("SELECT generation.revision, generation.generated_at FROM public_release_generation AS generation JOIN public_release_active_generation AS active ON active.revision = generation.revision AND active.id = 'active' LIMIT 1").first<ReleaseGenerationRow>();
    const parsed = rows.results.flatMap((row) => { try { return [publicReleaseEventSchema.parse({ id: row.id, provider: row.provider, providerWorkId: row.provider_work_id, releaseKind: row.release_kind, sequence: row.sequence_label ?? undefined, occurrence: { kind: row.occurrence_kind, value: row.occurrence_value }, state: row.state, provenance: { source: row.source, fetchedAt: row.fetched_at, parserVersion: row.parser_version, rulesVersion: row.rules_version }, expiresAt: row.expires_at })]; } catch { return []; } });
    const entries = parsed.slice(0, input.limit);
    const last = entries.at(-1);
    const nextCursor = parsed.length > input.limit && last ? `${last.occurrence.value}|${last.id}` : undefined;
    const page: CalendarPage = { entries: Object.freeze(entries), revision: generation?.revision ?? 'd1-empty', generatedAt: generation?.generated_at ?? '1970-01-01T00:00:00.000Z' };
    if (nextCursor) page.nextCursor = nextCursor;
    return page;
  }
}
