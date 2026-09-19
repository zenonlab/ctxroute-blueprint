import type { PublicReleaseEventContract, VirtualReleaseModelContract, VirtualReleaseModelInput } from '@tobirink/application';
import { projectVirtualAgenda, publicReleaseEventSchema, virtualReleaseModelSchema } from '@tobirink/application';
import { commitPublicReleaseGeneration } from './public-release-collectors';
import type { PublicReleaseIngestion } from './public-release-ingestion';

export interface PublicReleaseQuery { from?: string; to?: string; cursor?: string; limit: number }
export interface PublicReleaseCalendarPort {
  ingest(input: PublicReleaseIngestion): Promise<{ accepted: boolean; count: number; replayed: boolean; revision: string }>;
  query(input: PublicReleaseQuery): Promise<{ entries: readonly PublicReleaseEventContract[]; revision: string; generatedAt: string; window: { from: string; to: string }; nextCursor?: string }>;
  queryModels(input: PublicReleaseQuery): Promise<{ models: readonly VirtualReleaseModelContract[]; revision: string; generatedAt: string; window: { from: string; to: string }; nextCursor?: string }>;
}
interface CalendarPage { entries: readonly PublicReleaseEventContract[]; revision: string; generatedAt: string; window: { from: string; to: string }; nextCursor?: string }
interface ReleaseRow { id: string; provider: string; provider_work_id: string; release_kind: string; sequence_label: string | null; occurrence_kind: string; occurrence_value: string; state: string; source: string; fetched_at: string; parser_version: string; rules_version: string; expires_at: string }
interface ReleaseGenerationRow { revision: string; checked_at: string | null; generated_at: string; window_from: string; window_to: string }
interface ReleaseCursor { id: string | null; occurrence: string | null }
function compareReleaseEvents(left: PublicReleaseEventContract, right: PublicReleaseEventContract): number {
  return left.occurrence.value < right.occurrence.value ? -1 : left.occurrence.value > right.occurrence.value ? 1 : left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}
interface AgendaSnapshotReader {
  readLane(provider: 'anilist' | 'mangaupdates'): Promise<{
    activeDigest: string | null; activeSnapshotId: string | null; checkedAt: string | null; publishedCheckedAt?: string | null | undefined;
  }>;
  readPageVersion(key: string): Promise<{ complete: boolean; events: readonly PublicReleaseEventContract[] } | undefined>;
}
interface ReleaseModelRow {
  anchorDate: string; anchorSequence: string | null; editorialStatus: VirtualReleaseModelContract['editorialStatus'];
  exceptionsJson: string; explicitNextJson: string | null; intervalDays: number | null; modelDigest: string;
  observedAt: string; parserVersion: string; provider: VirtualReleaseModelContract['provider']; providerWorkId: string;
  releaseKind: VirtualReleaseModelContract['releaseKind']; revision: number; rulesVersion: string; source: string;
  validFrom: string; validTo: string; workId: string;
}
function releaseModel(row: ReleaseModelRow): VirtualReleaseModelContract {
  const model: VirtualReleaseModelInput = {
    workId: row.workId, provider: row.provider, providerWorkId: row.providerWorkId, releaseKind: row.releaseKind,
    anchor: { date: row.anchorDate }, exceptions: JSON.parse(row.exceptionsJson),
    validity: { from: row.validFrom, to: row.validTo }, editorialStatus: row.editorialStatus,
    provenance: { source: row.source, observedAt: row.observedAt, parserVersion: row.parserVersion, rulesVersion: row.rulesVersion },
    revision: `${row.modelDigest}-${row.editorialStatus}`,
  };
  if (row.anchorSequence !== null) model.anchor.sequence = row.anchorSequence;
  if (row.intervalDays !== null) model.intervalDays = row.intervalDays;
  if (row.explicitNextJson !== null) model.explicitNext = JSON.parse(row.explicitNextJson);
  return virtualReleaseModelSchema.parse(model);
}
function decodeCursor(cursor: string | undefined): ReleaseCursor {
  if (cursor === undefined) return { id: null, occurrence: null };
  const separator = cursor.indexOf('|');
  if (separator < 10 || separator === cursor.length - 1 || cursor.length > 256) throw new Error('invalid-release-cursor');
  return { occurrence: cursor.slice(0, separator), id: cursor.slice(separator + 1) };
}

export class D1PublicReleaseCalendarAdapter implements PublicReleaseCalendarPort {
  constructor(private readonly db: D1Database, private readonly snapshots?: AgendaSnapshotReader) {}
  private async modelGeneration(includeFreshness = true) {
    const summary = await this.db.prepare("SELECT revision, observed_at AS generatedAt FROM catalogue_release_generation WHERE id = 'active'")
      .first<{ revision: string; generatedAt: string }>();
    if (summary === null) throw new Error('agenda-generation-uninitialized');
    const legacy = await this.db.prepare("SELECT revision FROM public_release_active_generation WHERE id = 'active'").first<{ revision: string }>();
    const lanes = this.snapshots === undefined ? [] : await Promise.all((['anilist', 'mangaupdates'] as const).map(provider => this.snapshots!.readLane(provider)));
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([summary.revision, legacy?.revision, lanes.map(lane => [lane.activeSnapshotId, lane.activeDigest])])));
    const revision = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
    let generatedAt = summary.generatedAt;
    if (includeFreshness && this.snapshots !== undefined && generatedAt !== '1970-01-01T00:00:00.000Z') {
      const checked = lanes.map(lane => lane.publishedCheckedAt === undefined ? lane.checkedAt : lane.publishedCheckedAt).filter((value): value is string => value !== null).sort()[0];
      if (checked !== undefined && checked > generatedAt) generatedAt = checked;
    }
    return { revision: `models-v2-${revision}`, generatedAt };
  }
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
  async queryModels(input: PublicReleaseQuery) {
    const from = input.from ?? '0000-01-01'; const to = input.to ?? '9999-12-31';
    const summary = await this.modelGeneration();
    const rows = await this.db.prepare(`SELECT work_id AS workId, provider, provider_work_id AS providerWorkId,
      release_kind AS releaseKind, anchor_date AS anchorDate, anchor_sequence AS anchorSequence,
      interval_days AS intervalDays, explicit_next_json AS explicitNextJson, exceptions_json AS exceptionsJson,
      valid_from AS validFrom, valid_to AS validTo, editorial_status AS editorialStatus,
      source, observed_at AS observedAt, parser_version AS parserVersion, rules_version AS rulesVersion,
      model_digest AS modelDigest, revision FROM catalogue_release_model
      WHERE valid_to >= ?1 AND valid_from <= ?2 AND work_id > ?3 ORDER BY work_id LIMIT ?4`)
      .bind(from, to, input.cursor ?? '', input.limit + 1).all<ReleaseModelRow>();
    const pageRows = rows.results.slice(0, input.limit);
    const models = Object.freeze(pageRows.map(releaseModel));
    if ((await this.modelGeneration(false)).revision !== summary.revision) throw new Error('agenda-generation-changed');
    const nextCursor = rows.results.length > input.limit ? pageRows.at(-1)?.workId : undefined;
    const page = {
      models, ...summary, window: { from, to },
    };
    return nextCursor === undefined ? page : { ...page, nextCursor };
  }
  async query(input: { from?: string; to?: string; cursor?: string; limit: number }) {
    const cursor = decodeCursor(input.cursor);
    const lowerBound = input.from ?? '0000-01-01';
    const upperBound = input.to ? `${input.to}T23:59:59.999Z` : '9999-12-31T23:59:59.999Z';
    const summary = await this.modelGeneration();
    const modelRows = await this.db.prepare(`SELECT work_id AS workId, provider, provider_work_id AS providerWorkId,
      release_kind AS releaseKind, anchor_date AS anchorDate, anchor_sequence AS anchorSequence,
      interval_days AS intervalDays, explicit_next_json AS explicitNextJson, exceptions_json AS exceptionsJson,
      valid_from AS validFrom, valid_to AS validTo, editorial_status AS editorialStatus,
      source, observed_at AS observedAt, parser_version AS parserVersion, rules_version AS rulesVersion,
      model_digest AS modelDigest, revision FROM catalogue_release_model
      WHERE valid_to >= ?1 AND valid_from <= ?2 ORDER BY work_id LIMIT 10001`)
      .bind(lowerBound.slice(0, 10), upperBound.slice(0, 10)).all<ReleaseModelRow>();
    if (modelRows.results.length > 0) {
      if (modelRows.results.length > 10000) throw new Error('agenda-compatibility-model-limit');
      const models = modelRows.results.map(releaseModel);
      const projected = projectVirtualAgenda(models, { from: lowerBound.slice(0, 10), to: upperBound.slice(0, 10) })
        .filter((event) => cursor.occurrence === null || event.occurrence.value > cursor.occurrence
          || (event.occurrence.value === cursor.occurrence && event.id > (cursor.id ?? '')));
      const excluded = new Set(models.map(model => `${model.provider}:${model.providerWorkId}`));
      const historical = await this.queryHistorical({ ...input, limit: input.limit + 1 }, cursor, lowerBound, upperBound, excluded);
      const merged = [...historical.entries, ...projected].sort(compareReleaseEvents);
      if ((await this.modelGeneration(false)).revision !== summary.revision) throw new Error('agenda-generation-changed');
      const entries = merged.slice(0, input.limit);
      const last = entries.at(-1);
      const nextCursor = merged.length > input.limit && last ? `${last.occurrence.value}|${last.id}` : undefined;
      const page: CalendarPage = { entries, ...summary, window: { from: lowerBound.slice(0, 10), to: upperBound.slice(0, 10) } };
      if (nextCursor !== undefined) page.nextCursor = nextCursor;
      return page;
    }
    return this.queryHistorical(input, cursor, lowerBound, upperBound, new Set());
  }

  private async queryHistorical(input: PublicReleaseQuery, cursor: ReleaseCursor, lowerBound: string, upperBound: string, excluded: ReadonlySet<string>): Promise<CalendarPage> {
    const snapshotPage = await this.queryCompatibilitySnapshots(input, cursor, lowerBound, upperBound, excluded);
    if (snapshotPage !== null) return snapshotPage;
    const generation = await this.db.prepare("SELECT generation.revision, generation.checked_at, generation.generated_at, generation.window_from, generation.window_to FROM public_release_generation AS generation JOIN public_release_active_generation AS active ON active.revision = generation.revision AND active.id = 'active' LIMIT 1").first<ReleaseGenerationRow>();
    const emptyRows: ReleaseRow[] = [];
    const rows = generation === null
      ? { results: emptyRows }
      : await this.db.prepare(`SELECT id, provider, provider_work_id, release_kind, sequence_label, occurrence_kind, occurrence_value, state, source, fetched_at, parser_version, rules_version, expires_at FROM public_release_current_event AS event
        WHERE occurrence_value >= ?1 AND occurrence_value <= ?2 AND (occurrence_value > ?3 OR (occurrence_value = ?3 AND id > ?4))
        AND NOT EXISTS (SELECT 1 FROM catalogue_release_model AS model WHERE model.provider = event.provider AND model.provider_work_id = event.provider_work_id AND model.valid_to >= ?6 AND model.valid_from <= ?7)
        ORDER BY occurrence_value, id LIMIT ?5`).bind(lowerBound, upperBound, cursor.occurrence ?? lowerBound, cursor.id ?? '', input.limit + 1, lowerBound.slice(0, 10), upperBound.slice(0, 10)).all<ReleaseRow>();
    const parsed = rows.results.map((row) => publicReleaseEventSchema.parse({ id: row.id, provider: row.provider, providerWorkId: row.provider_work_id, releaseKind: row.release_kind, sequence: row.sequence_label ?? undefined, occurrence: { kind: row.occurrence_kind, value: row.occurrence_value }, state: row.state, provenance: { source: row.source, fetchedAt: row.fetched_at, parserVersion: row.parser_version, rulesVersion: row.rules_version }, expiresAt: row.expires_at }));
    const entries = parsed.slice(0, input.limit);
    const last = entries.at(-1);
    const nextCursor = parsed.length > input.limit && last ? `${last.occurrence.value}|${last.id}` : undefined;
    const page: CalendarPage = { entries: Object.freeze(entries), revision: generation?.revision ?? 'd1-empty', generatedAt: generation?.checked_at ?? generation?.generated_at ?? '1970-01-01T00:00:00.000Z', window: { from: generation?.window_from ?? '1970-01-01', to: generation?.window_to ?? '1970-01-01' } };
    if (nextCursor) page.nextCursor = nextCursor;
    return page;
  }

  private async queryCompatibilitySnapshots(
    input: PublicReleaseQuery,
    cursor: ReleaseCursor,
    lowerBound: string,
    upperBound: string,
    excluded: ReadonlySet<string>,
  ): Promise<CalendarPage | null> {
    if (this.snapshots === undefined) return null;
    const providers = ['anilist', 'mangaupdates'] as const;
    const lanes = await Promise.all(providers.map(async (provider) => ({ provider, lane: await this.snapshots!.readLane(provider) })));
    if (lanes.every(({ lane }) => lane.activeSnapshotId === null)) return null;
    const events: PublicReleaseEventContract[] = [];
    for (const { provider, lane } of lanes) {
      if (lane.activeSnapshotId !== null) {
        const snapshot = await this.snapshots.readPageVersion(['snapshots', provider, lane.activeSnapshotId].join('/'));
        if (snapshot === undefined || !snapshot.complete) throw new Error('agenda-active-snapshot-incomplete');
        events.push(...snapshot.events.map((event) => publicReleaseEventSchema.parse(event)));
        continue;
      }
      const legacy = await this.db.prepare(`SELECT id, provider, provider_work_id, release_kind,
        sequence_label, occurrence_kind, occurrence_value, state, source, fetched_at,
        parser_version, rules_version, expires_at FROM public_release_current_event
        WHERE provider = ?1 ORDER BY occurrence_value, id`).bind(provider).all<ReleaseRow>();
      events.push(...legacy.results.map((row) => publicReleaseEventSchema.parse({
        id: row.id, provider: row.provider, providerWorkId: row.provider_work_id,
        releaseKind: row.release_kind, sequence: row.sequence_label ?? undefined,
        occurrence: { kind: row.occurrence_kind, value: row.occurrence_value }, state: row.state,
        provenance: { source: row.source, fetchedAt: row.fetched_at, parserVersion: row.parser_version, rulesVersion: row.rules_version },
        expiresAt: row.expires_at,
      })));
    }
    const filtered = events
      .filter(event => !excluded.has(`${event.provider}:${event.providerWorkId}`))
      .filter((event) => event.occurrence.value >= lowerBound && event.occurrence.value <= upperBound)
      .filter((event) => cursor.occurrence === null || event.occurrence.value > cursor.occurrence
        || (event.occurrence.value === cursor.occurrence && event.id > (cursor.id ?? '')))
      .sort(compareReleaseEvents);
    const entries = Object.freeze(filtered.slice(0, input.limit));
    const last = entries.at(-1);
    const nextCursor = filtered.length > input.limit && last ? `${last.occurrence.value}|${last.id}` : undefined;
    const checkedAt = lanes.flatMap(({ lane }) => (lane.publishedCheckedAt ?? lane.checkedAt) === null ? [] : [lane.publishedCheckedAt ?? lane.checkedAt!]).sort()[0]
      ?? '1970-01-01T00:00:00.000Z';
    const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(events)));
    const digest = Array.from(new Uint8Array(digestBytes), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 48);
    const page: CalendarPage = {
      entries, revision: `r2-compat-${digest}`, generatedAt: checkedAt,
      window: { from: lowerBound.slice(0, 10), to: upperBound.slice(0, 10) },
    };
    if (nextCursor !== undefined) page.nextCursor = nextCursor;
    return page;
  }
}
