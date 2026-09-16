import type { PublicReleaseEventContract } from '@tobirink/application';
import { publicAgendaReleaseEventSchema, type PublicAgendaPageCheckpoint, type PublicAgendaReleaseEvent } from '@tobirink/public-discovery/agenda';

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
type AgendaProvider = 'anilist' | 'mangaupdates';
interface AgendaLaneStateRow {
  activeDigest: string | null;
  activeSnapshotId: string | null;
  collectionId: string | null;
  completedFor: string | null;
  leaseUntil: string | null;
  nextPage: number;
  notBefore: string | null;
  receivedCount: number;
  scheduledFor: string | null;
  skippedCount: number;
  windowFrom: string | null;
  windowTo: string | null;
}
interface AgendaPageRow { complete: number; eventsJson: string; page: number }
interface AgendaLaneEvents { events: readonly PublicAgendaReleaseEvent[]; window?: { from: string; to: string } }
interface AgendaEventCandidate {
  expiresAt: string | null;
  id: string | null;
  occurrence: { kind: string | null; value: string | null };
  provenance: { fetchedAt: string | null; parserVersion: string | null; rulesVersion: string | null; source: string | null };
  provider: string | null;
  providerWorkId: string | null;
  releaseKind: string | null;
  sequence?: string;
  state: string | null;
}
interface AgendaGenerationEventRow {
  expiresAt: string;
  fetchedAt: string;
  id: string;
  occurrenceKind: string;
  occurrenceValue: string;
  parserVersion: string;
  provider: string;
  providerWorkId: string;
  releaseKind: string;
  rulesVersion: string;
  sequence: string | null;
  source: string;
  state: string;
}
export interface AgendaLaneClaim {
  readonly collectionId: string;
  readonly nextPage: number;
  readonly received: number;
  readonly skippedUnidentified: number;
  readonly tokenDigest: string;
}
export type AgendaLaneAdmission =
  | { readonly status: 'claimed'; readonly claim: AgendaLaneClaim }
  | { readonly status: 'complete' }
  | { readonly status: 'leased' }
  | { readonly status: 'deferred'; readonly retryAt: string };
export interface AgendaLaneCompletion { readonly changed: boolean; readonly digest: string; readonly events: readonly PublicAgendaReleaseEvent[] }
export interface AgendaGenerationReceipt { readonly changed: boolean; readonly count: number; readonly revision: string }

const maxAgendaSnapshotBytes = 1_800_000;

async function sha256(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function semanticAgendaEvents(events: readonly PublicAgendaReleaseEvent[]): readonly unknown[] {
  return [...events]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((event) => ({
      id: event.id,
      occurrence: event.occurrence,
      parserVersion: event.provenance.parserVersion,
      provider: event.provider,
      providerWorkId: event.providerWorkId,
      releaseKind: event.releaseKind,
      rulesVersion: event.provenance.rulesVersion,
      sequence: event.sequence,
      source: event.provenance.source,
      state: event.state,
    }));
}

function agendaSnapshot(events: readonly PublicReleaseEventContract[]): string {
  const snapshot = JSON.stringify([...events].sort((left, right) => left.id.localeCompare(right.id)));
  if (new TextEncoder().encode(snapshot).byteLength > maxAgendaSnapshotBytes) throw new Error('agenda-snapshot-too-large');
  return snapshot;
}

export async function digestPublicAgendaEvents(events: readonly PublicAgendaReleaseEvent[]): Promise<string> {
  return sha256(JSON.stringify(semanticAgendaEvents(events)));
}

function parseAgendaPages(rows: readonly AgendaPageRow[]): readonly PublicAgendaReleaseEvent[] {
  if (rows.length === 0 || rows.at(-1)?.complete !== 1) throw new Error('agenda-staging-incomplete');
  const events = new Map<string, PublicAgendaReleaseEvent>();
  rows.forEach((row, index) => {
    if (row.page !== index + 1) throw new Error('agenda-staging-page-gap');
    const page = publicAgendaReleaseEventSchema.array().parse(JSON.parse(row.eventsJson));
    for (const event of page) events.set(event.id, event);
  });
  return Object.freeze([...events.values()]);
}

function laneState(db: PublicReleaseD1Writer, provider: AgendaProvider): Promise<AgendaLaneStateRow | null> {
  return db.prepare(`SELECT active_digest AS activeDigest, active_snapshot_id AS activeSnapshotId,
    collection_id AS collectionId, completed_for AS completedFor, lease_until AS leaseUntil,
    next_page AS nextPage, not_before AS notBefore, received_count AS receivedCount,
    scheduled_for AS scheduledFor, skipped_count AS skippedCount,
    window_from AS windowFrom, window_to AS windowTo
    FROM public_release_agenda_lane_state WHERE provider = ?1`).bind(provider).first<AgendaLaneStateRow>();
}

export class D1AgendaCollectionAdapter {
  constructor(private readonly db: PublicReleaseD1Writer) {}

  async claimLane(input: { provider: AgendaProvider; scheduledFor: string; window: { from: string; to: string }; now: string; leaseUntil: string; tokenDigest: string; collectionId: string }): Promise<AgendaLaneAdmission> {
    const current = await laneState(this.db, input.provider);
    if (current?.completedFor === input.scheduledFor) return { status: 'complete' };
    if (current?.scheduledFor === input.scheduledFor && current.notBefore !== null && current.notBefore > input.now) return { status: 'deferred', retryAt: current.notBefore };
    const resumed = current?.scheduledFor === input.scheduledFor && current.collectionId !== null;
    const claimed = await this.db.prepare(`UPDATE public_release_agenda_lane_state SET
      collection_id = ?1, scheduled_for = ?2, window_from = ?3, window_to = ?4,
      next_page = ?5, received_count = ?6, skipped_count = ?7, not_before = NULL,
      lease_token_hash = ?8, lease_until = ?9, last_error_code = NULL
      WHERE provider = ?10
        AND (completed_for IS NULL OR completed_for <> ?2)
        AND (lease_until IS NULL OR lease_until <= ?11)
      RETURNING collection_id AS collectionId, next_page AS nextPage,
        received_count AS receivedCount, skipped_count AS skippedCount`)
      .bind(
        resumed ? current.collectionId : input.collectionId,
        input.scheduledFor,
        input.window.from,
        input.window.to,
        resumed ? current.nextPage : 1,
        resumed ? current.receivedCount : 0,
        resumed ? current.skippedCount : 0,
        input.tokenDigest,
        input.leaseUntil,
        input.provider,
        input.now,
      ).first<{ collectionId: string; nextPage: number; receivedCount: number; skippedCount: number }>();
    if (claimed === null) return { status: 'leased' };
    return { status: 'claimed', claim: { collectionId: claimed.collectionId, nextPage: claimed.nextPage, received: claimed.receivedCount, skippedUnidentified: claimed.skippedCount, tokenDigest: input.tokenDigest } };
  }

  async savePage(claim: AgendaLaneClaim, checkpoint: PublicAgendaPageCheckpoint, savedAt: string): Promise<void> {
    const nextPage = checkpoint.nextPage ?? checkpoint.page;
    const results = await this.db.batch([
      this.db.prepare(`INSERT INTO public_release_agenda_page (
        collection_id, provider, page, events_json, event_count, received_count,
        skipped_count, next_page, complete, saved_at
      ) SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
      WHERE EXISTS (SELECT 1 FROM public_release_agenda_lane_state
        WHERE provider = ?2 AND collection_id = ?1 AND lease_token_hash = ?11 AND lease_until > ?10)
      ON CONFLICT(collection_id, provider, page) DO UPDATE SET
        events_json = excluded.events_json, event_count = excluded.event_count,
        received_count = excluded.received_count, skipped_count = excluded.skipped_count,
        next_page = excluded.next_page, complete = excluded.complete, saved_at = excluded.saved_at`)
        .bind(claim.collectionId, checkpoint.provider, checkpoint.page, JSON.stringify(checkpoint.events), checkpoint.events.length, checkpoint.received, checkpoint.skippedUnidentified, checkpoint.nextPage ?? null, checkpoint.complete ? 1 : 0, savedAt, claim.tokenDigest),
      this.db.prepare(`UPDATE public_release_agenda_lane_state SET next_page = ?1,
        received_count = ?2, skipped_count = ?3, not_before = ?4
        WHERE provider = ?5 AND collection_id = ?6 AND lease_token_hash = ?7 AND lease_until > ?8`)
        .bind(nextPage, checkpoint.received, checkpoint.skippedUnidentified, checkpoint.notBefore === undefined ? null : new Date(checkpoint.notBefore).toISOString(), checkpoint.provider, claim.collectionId, claim.tokenDigest, savedAt),
    ]);
    if (results.some((result) => result.meta.changes !== 1)) throw new Error('agenda-lane-lease-lost');
  }

  async failLane(input: { provider: AgendaProvider; claim: AgendaLaneClaim; retryAt: string; errorCode: string }): Promise<void> {
    await this.db.prepare(`UPDATE public_release_agenda_lane_state SET not_before = ?1,
      lease_token_hash = NULL, lease_until = NULL, last_error_code = ?2
      WHERE provider = ?3 AND collection_id = ?4 AND lease_token_hash = ?5`)
      .bind(input.retryAt, input.errorCode, input.provider, input.claim.collectionId, input.claim.tokenDigest).run();
  }

  async completeLane(input: { provider: AgendaProvider; claim: AgendaLaneClaim; scheduledFor: string; checkedAt: string }): Promise<AgendaLaneCompletion> {
    const pages = await this.db.prepare(`SELECT complete, events_json AS eventsJson, page
      FROM public_release_agenda_page WHERE provider = ?1 AND collection_id = ?2 ORDER BY page`)
      .bind(input.provider, input.claim.collectionId).all<AgendaPageRow>();
    const events = parseAgendaPages(pages.results);
    const digest = await digestPublicAgendaEvents(events);
    const state = await laneState(this.db, input.provider);
    const changed = state?.activeDigest !== digest;
    const result = await this.db.prepare(`UPDATE public_release_agenda_lane_state SET
      active_snapshot_id = CASE WHEN ?1 = 1 THEN collection_id ELSE active_snapshot_id END,
      active_digest = CASE WHEN ?1 = 1 THEN ?2 ELSE active_digest END,
      checked_at = ?3, last_success_at = ?3, completed_for = ?4,
      collection_id = NULL, next_page = 1, received_count = 0, skipped_count = 0,
      not_before = NULL, lease_token_hash = NULL, lease_until = NULL, last_error_code = NULL
      WHERE provider = ?5 AND collection_id = ?6 AND lease_token_hash = ?7 AND lease_until > ?3`)
      .bind(changed ? 1 : 0, digest, input.checkedAt, input.scheduledFor, input.provider, input.claim.collectionId, input.claim.tokenDigest).run();
    if (result.meta.changes !== 1) throw new Error('agenda-lane-lease-lost');
    return { changed, digest, events };
  }

  async publishMergedGeneration(checkedAt: string): Promise<AgendaGenerationReceipt | null> {
    const [anilist, mangaupdates] = await Promise.all([this.readLaneEvents('anilist'), this.readLaneEvents('mangaupdates')]);
    const events = [...anilist.events, ...mangaupdates.events];
    if (events.length === 0) return null;
    const digest = await digestPublicAgendaEvents(events);
    const revision = `calendar-${digest.slice(0, 48)}`;
    const active = await this.db.prepare(`SELECT generation.revision,
      generation.window_from AS windowFrom, generation.window_to AS windowTo
      FROM public_release_active_generation AS pointer
      JOIN public_release_generation AS generation ON generation.revision = pointer.revision
      WHERE pointer.id = 'active'`).first<{ revision: string; windowFrom: string; windowTo: string }>();
    if (active?.revision === revision) {
      await this.db.prepare('UPDATE public_release_generation SET checked_at = ?1 WHERE revision = ?2').bind(checkedAt, revision).run();
      await this.pruneCompletedPages();
      return { changed: false, count: events.length, revision };
    }
    const from = [anilist.window?.from, mangaupdates.window?.from, active?.windowFrom].filter((value): value is string => value !== undefined).sort()[0] ?? checkedAt.slice(0, 10);
    const to = [anilist.window?.to, mangaupdates.window?.to, active?.windowTo].filter((value): value is string => value !== undefined).sort().at(-1) ?? checkedAt.slice(0, 10);
    await commitPublicReleaseGeneration(this.db, events, { from, to }, revision, checkedAt);
    await this.pruneCompletedPages();
    return { changed: true, count: events.length, revision };
  }

  private async pruneCompletedPages(): Promise<void> {
    await this.db.prepare(`DELETE FROM public_release_agenda_page
      WHERE NOT EXISTS (
        SELECT 1 FROM public_release_agenda_lane_state AS lane
        WHERE public_release_agenda_page.collection_id IN (lane.active_snapshot_id, lane.collection_id)
      )`).run();
  }

  private async readLaneEvents(provider: AgendaProvider): Promise<AgendaLaneEvents> {
    const state = await laneState(this.db, provider);
    if (state?.activeSnapshotId !== null && state?.activeSnapshotId !== undefined) {
      const pages = await this.db.prepare(`SELECT complete, events_json AS eventsJson, page
        FROM public_release_agenda_page WHERE provider = ?1 AND collection_id = ?2 ORDER BY page`)
        .bind(provider, state.activeSnapshotId).all<AgendaPageRow>();
      const snapshot: AgendaLaneEvents = { events: parseAgendaPages(pages.results) };
      if (state.windowFrom !== null && state.windowTo !== null) snapshot.window = { from: state.windowFrom, to: state.windowTo };
      return snapshot;
    }
    const generation = await this.db.prepare(`SELECT generation.revision,
      generation.window_from AS windowFrom, generation.window_to AS windowTo
      FROM public_release_active_generation AS pointer
      JOIN public_release_generation AS generation ON generation.revision = pointer.revision
      WHERE pointer.id = 'active'`).first<{ revision: string; windowFrom: string; windowTo: string }>();
    if (generation === null) return { events: [] };
    const rows = await this.db.prepare(`SELECT id, provider, provider_work_id AS providerWorkId,
      release_kind AS releaseKind, sequence_label AS sequence, occurrence_kind AS occurrenceKind,
      occurrence_value AS occurrenceValue, state, source, fetched_at AS fetchedAt,
      parser_version AS parserVersion, rules_version AS rulesVersion, expires_at AS expiresAt
      FROM public_release_current_event WHERE provider = ?1 ORDER BY id`)
      .bind(provider).all<AgendaGenerationEventRow>();
    const events = rows.results.map((row) => {
      const candidate: AgendaEventCandidate = {
        expiresAt: row.expiresAt, id: row.id,
        occurrence: { kind: row.occurrenceKind, value: row.occurrenceValue },
        provenance: { fetchedAt: row.fetchedAt, parserVersion: row.parserVersion, rulesVersion: row.rulesVersion, source: row.source },
        provider: row.provider, providerWorkId: row.providerWorkId, releaseKind: row.releaseKind, state: row.state,
      };
      if (row.sequence !== null) candidate.sequence = row.sequence;
      return publicAgendaReleaseEventSchema.parse(candidate);
    });
    return { events, window: { from: generation.windowFrom, to: generation.windowTo } };
  }
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
  const snapshot = agendaSnapshot(events);
  return db.batch([
    db.prepare("INSERT OR IGNORE INTO public_release_generation (revision, status, generated_at, window_from, window_to, event_count, checked_at, events_json) VALUES (?1, 'staging', ?2, ?3, ?4, ?5, ?2, ?6)")
      .bind(revision, generatedAt, window.from, window.to, events.length, snapshot),
    db.prepare(`INSERT INTO public_release_current_event (
      id, provider, provider_work_id, release_kind, sequence_label,
      occurrence_kind, occurrence_value, state, source, fetched_at,
      parser_version, rules_version, expires_at
    ) SELECT
      json_extract(value, '$.id'), json_extract(value, '$.provider'),
      json_extract(value, '$.providerWorkId'), json_extract(value, '$.releaseKind'),
      json_extract(value, '$.sequence'), json_extract(value, '$.occurrence.kind'),
      json_extract(value, '$.occurrence.value'), json_extract(value, '$.state'),
      json_extract(value, '$.provenance.source'), json_extract(value, '$.provenance.fetchedAt'),
      json_extract(value, '$.provenance.parserVersion'), json_extract(value, '$.provenance.rulesVersion'),
      json_extract(value, '$.expiresAt')
    FROM json_each(?1)
    WHERE NOT EXISTS (
      SELECT 1 FROM public_release_active_generation AS pointer
      JOIN public_release_generation AS current ON current.revision = pointer.revision
      WHERE pointer.id = 'active' AND current.generated_at > ?2
    )
    ON CONFLICT(id) DO UPDATE SET
      provider = excluded.provider, provider_work_id = excluded.provider_work_id,
      release_kind = excluded.release_kind, sequence_label = excluded.sequence_label,
      occurrence_kind = excluded.occurrence_kind, occurrence_value = excluded.occurrence_value,
      state = excluded.state, source = excluded.source, fetched_at = excluded.fetched_at,
      parser_version = excluded.parser_version, rules_version = excluded.rules_version,
      expires_at = excluded.expires_at
    WHERE public_release_current_event.provider IS NOT excluded.provider
      OR public_release_current_event.provider_work_id IS NOT excluded.provider_work_id
      OR public_release_current_event.release_kind IS NOT excluded.release_kind
      OR public_release_current_event.sequence_label IS NOT excluded.sequence_label
      OR public_release_current_event.occurrence_kind IS NOT excluded.occurrence_kind
      OR public_release_current_event.occurrence_value IS NOT excluded.occurrence_value
      OR public_release_current_event.state IS NOT excluded.state
      OR public_release_current_event.source IS NOT excluded.source
      OR public_release_current_event.parser_version IS NOT excluded.parser_version
      OR public_release_current_event.rules_version IS NOT excluded.rules_version`)
      .bind(snapshot, generatedAt),
    db.prepare(`DELETE FROM public_release_current_event
      WHERE id NOT IN (SELECT json_extract(value, '$.id') FROM json_each(?1))
        AND NOT EXISTS (
          SELECT 1 FROM public_release_active_generation AS pointer
          JOIN public_release_generation AS current ON current.revision = pointer.revision
          WHERE pointer.id = 'active' AND current.generated_at > ?2
        )`).bind(snapshot, generatedAt),
    db.prepare("UPDATE public_release_generation SET status = 'staging' WHERE status = 'active' AND revision <> ?1 AND generated_at <= ?2 AND EXISTS (SELECT 1 FROM public_release_generation AS candidate WHERE candidate.revision = ?1 AND json_array_length(candidate.events_json) = candidate.event_count)").bind(revision, generatedAt),
    db.prepare("UPDATE public_release_generation SET status = 'active' WHERE revision = ?1 AND json_array_length(events_json) = event_count AND NOT EXISTS (SELECT 1 FROM public_release_active_generation AS pointer JOIN public_release_generation AS current ON current.revision = pointer.revision WHERE pointer.id = 'active' AND current.generated_at > ?2)").bind(revision, generatedAt),
    db.prepare("INSERT INTO public_release_active_generation (id, revision) SELECT 'active', ?1 WHERE EXISTS (SELECT 1 FROM public_release_generation AS candidate WHERE candidate.revision = ?1 AND json_array_length(candidate.events_json) = candidate.event_count) AND NOT EXISTS (SELECT 1 FROM public_release_active_generation AS pointer JOIN public_release_generation AS current ON current.revision = pointer.revision WHERE pointer.id = 'active' AND current.generated_at > ?2) ON CONFLICT(id) DO UPDATE SET revision = excluded.revision").bind(revision, generatedAt),
    db.prepare("DELETE FROM public_release_generation_event WHERE generation_revision IN (SELECT candidate.revision FROM public_release_generation AS candidate WHERE candidate.revision <> (SELECT revision FROM public_release_active_generation WHERE id = 'active') AND candidate.revision NOT IN (SELECT retained.revision FROM public_release_generation AS retained WHERE retained.revision <> (SELECT revision FROM public_release_active_generation WHERE id = 'active') ORDER BY retained.generated_at DESC, retained.revision DESC LIMIT 2)) AND (SELECT revision FROM public_release_active_generation WHERE id = 'active') = ?1").bind(revision),
    db.prepare("DELETE FROM public_release_generation WHERE revision <> (SELECT revision FROM public_release_active_generation WHERE id = 'active') AND revision NOT IN (SELECT retained.revision FROM public_release_generation AS retained WHERE retained.revision <> (SELECT revision FROM public_release_active_generation WHERE id = 'active') ORDER BY retained.generated_at DESC, retained.revision DESC LIMIT 2) AND (SELECT revision FROM public_release_active_generation WHERE id = 'active') = ?1").bind(revision),
  ]);
}
