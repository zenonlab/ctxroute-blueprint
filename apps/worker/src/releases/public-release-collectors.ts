import { publicReleaseEventSchema, type PublicReleaseEventContract } from '@tobirink/application';
import { predictNextMangaRelease } from '@tobirink/domain';
import type { R2AgendaOperationStore } from '@tobirink/adapters-cloudflare';
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
interface AgendaWorkMappingRow { editorialStatus: 'UPCOMING' | 'ONGOING' | 'HIATUS' | 'COMPLETED' | 'CANCELLED' | 'UNKNOWN' | null; externalId: string; provider: string; workId: string }
interface AgendaModelDigestRow { modelDigest: string; revision: number; workId: string }
interface ExpiredAgendaModelRow extends AgendaModelDigestRow { explicitNextJson: string | null; exceptionsJson: string }
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
  constructor(private readonly db: PublicReleaseD1Writer, private readonly operations?: R2AgendaOperationStore) {}

  private async readLaneState(provider: AgendaProvider): Promise<AgendaLaneStateRow | null> {
    if (this.operations === undefined) return laneState(this.db, provider);
    const state = await this.operations.readLane(provider);
    return {
      activeDigest: state.activeDigest, activeSnapshotId: state.activeSnapshotId,
      collectionId: state.collectionId, completedFor: state.completedFor, leaseUntil: state.leaseUntil,
      nextPage: state.nextPage, notBefore: state.notBefore, receivedCount: state.received,
      scheduledFor: state.scheduledFor, skippedCount: state.skipped,
      windowFrom: state.windowFrom, windowTo: state.windowTo,
    };
  }

  async claimLane(input: { provider: AgendaProvider; scheduledFor: string; window: { from: string; to: string }; now: string; leaseUntil: string; tokenDigest: string; collectionId: string }): Promise<AgendaLaneAdmission> {
    if (this.operations !== undefined) return this.operations.claimLane(input);
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
    if (this.operations !== undefined) {
      await this.operations.writePageVersion({
        key: ['pages', checkpoint.provider, claim.collectionId, String(checkpoint.page)].join('/'),
        payload: checkpoint, ownerToken: claim.tokenDigest, now: savedAt,
      });
      await this.operations.advanceLane({ provider: checkpoint.provider, collectionId: claim.collectionId, tokenDigest: claim.tokenDigest, checkpoint, now: savedAt });
      return;
    }
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
    if (this.operations !== undefined) {
      await this.operations.failLane({ provider: input.provider, collectionId: input.claim.collectionId, tokenDigest: input.claim.tokenDigest, retryAt: input.retryAt });
      return;
    }
    await this.db.prepare(`UPDATE public_release_agenda_lane_state SET not_before = ?1,
      lease_token_hash = NULL, lease_until = NULL, last_error_code = ?2
      WHERE provider = ?3 AND collection_id = ?4 AND lease_token_hash = ?5`)
      .bind(input.retryAt, input.errorCode, input.provider, input.claim.collectionId, input.claim.tokenDigest).run();
  }

  async completeLane(input: { provider: AgendaProvider; claim: AgendaLaneClaim; scheduledFor: string; checkedAt: string }): Promise<AgendaLaneCompletion> {
    const state = await this.readLaneState(input.provider);
    if (state?.collectionId !== input.claim.collectionId) throw new Error('agenda-lane-lease-lost');
    let pageRows: readonly AgendaPageRow[];
    if (this.operations === undefined) {
      pageRows = (await this.db.prepare(`SELECT complete, events_json AS eventsJson, page
        FROM public_release_agenda_page WHERE provider = ?1 AND collection_id = ?2 ORDER BY page`)
        .bind(input.provider, input.claim.collectionId).all<AgendaPageRow>()).results;
    } else {
      const pages: Array<PublicAgendaPageCheckpoint | undefined> = [];
      for (let index = 0; index < state.nextPage; index += 1) {
        pages.push(await this.operations.readPageVersion(
          ['pages', input.provider, input.claim.collectionId, String(index + 1)].join('/'), input.claim.tokenDigest,
        ));
      }
      pageRows = pages.map((page, index) => {
        if (page === undefined) throw new Error('agenda-staging-page-gap');
        return { complete: page.complete ? 1 : 0, eventsJson: JSON.stringify(page.events), page: index + 1 };
      });
    }
    const events = parseAgendaPages(pageRows);
    const digest = await digestPublicAgendaEvents(events);
    const changed = state?.activeDigest !== digest;
    if (this.operations !== undefined) {
      await this.operations.writePageVersion({
        key: ['snapshots', input.provider, input.claim.collectionId].join('/'),
        payload: { complete: true, events, page: 1, provider: input.provider, received: events.length, skippedUnidentified: input.claim.skippedUnidentified },
        ownerToken: input.claim.tokenDigest, now: input.checkedAt, retention: 'retained',
      });
    }
    if (this.operations !== undefined) {
      await this.operations.completeLane({ provider: input.provider, collectionId: input.claim.collectionId, tokenDigest: input.claim.tokenDigest, scheduledFor: input.scheduledFor, checkedAt: input.checkedAt, digest, changed });
      return { changed, digest, events };
    }
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
    const active = await this.db.prepare(`SELECT generation.revision,
      generation.window_from AS windowFrom, generation.window_to AS windowTo
      FROM public_release_active_generation AS pointer
      JOIN public_release_generation AS generation ON generation.revision = pointer.revision
      WHERE pointer.id = 'active'`).first<{ revision: string; windowFrom: string; windowTo: string }>();
    const from = [anilist.window?.from, mangaupdates.window?.from, active?.windowFrom].filter((value): value is string => value !== undefined).sort()[0] ?? checkedAt.slice(0, 10);
    const to = [anilist.window?.to, mangaupdates.window?.to, active?.windowTo].filter((value): value is string => value !== undefined).sort().at(-1) ?? checkedAt.slice(0, 10);
    const virtual = await this.publishVirtualModels(events, { from, to }, checkedAt);
    if (virtual !== null) {
      await this.pruneCompletedPages();
      return { changed: virtual.changed, count: events.length, revision: virtual.revision };
    }
    const digest = await digestPublicAgendaEvents(events);
    const revision = `calendar-${digest.slice(0, 48)}`;
    if (active?.revision === revision) {
      await this.db.prepare('UPDATE public_release_generation SET checked_at = ?1 WHERE revision = ?2').bind(checkedAt, revision).run();
      await this.pruneCompletedPages();
      return { changed: false, count: events.length, revision };
    }
    await commitPublicReleaseGeneration(this.db, events, { from, to }, revision, checkedAt);
    await this.pruneCompletedPages();
    return { changed: true, count: events.length, revision };
  }

  private async publishVirtualModels(events: readonly PublicAgendaReleaseEvent[], window: { from: string; to: string }, checkedAt: string): Promise<{ changed: boolean; revision: string } | null> {
    const references = [...new Map(events.map((event) => [`${event.provider}:${event.providerWorkId}`, { provider: event.provider, externalId: event.providerWorkId }])).values()];
    const mappings = (await this.db.prepare(`SELECT reference.provider, reference.external_id AS externalId,
      reference.work_id AS workId, metadata.editorial_status AS editorialStatus
      FROM catalogue_external_references AS reference
      JOIN json_each(?1) AS requested
        ON reference.provider = json_extract(requested.value, '$.provider')
       AND reference.external_id = json_extract(requested.value, '$.externalId')
      LEFT JOIN catalogue_current_metadata AS metadata ON metadata.work_id = reference.work_id`)
      .bind(JSON.stringify(references)).all<AgendaWorkMappingRow>()).results;
    const grouped = new Map<string, { events: PublicReleaseEventContract[]; mapping: AgendaWorkMappingRow }>();
    for (const sourceEvent of events) {
      const event = publicReleaseEventSchema.parse(sourceEvent);
      const resolved = mappings.find((row) => row.provider === event.provider && row.externalId === event.providerWorkId);
      if (resolved === undefined) continue;
      const current = grouped.get(resolved.workId) ?? { events: [], mapping: resolved };
      current.events.push(event); grouped.set(resolved.workId, current);
    }
    if (grouped.size === 0) return null;
    const existing = (await this.db.prepare(`SELECT work_id AS workId, model_digest AS modelDigest, revision
      FROM catalogue_release_model WHERE work_id IN (SELECT value FROM json_each(?1))`)
      .bind(JSON.stringify([...grouped.keys()])).all<AgendaModelDigestRow>()).results;
    const digests = new Map(existing.map((row) => [row.workId, row.modelDigest]));
    const revision = Date.parse(checkedAt);
    const statements: D1PreparedStatement[] = [];
    const changedWorkIds: string[] = [];
    for (const [workId, group] of grouped) {
      const ordered = group.events.sort((left, right) => left.occurrence.value.localeCompare(right.occurrence.value) || left.id.localeCompare(right.id));
      const provider = ordered.some((event) => event.provider === 'anilist') ? 'anilist' as const : 'mangaupdates' as const;
      const selected = ordered.filter((event) => event.provider === provider).slice(-32);
      const last = selected.at(-1);
      if (last === undefined) continue;
      let intervalDays: number | undefined;
      let anchorDate = last.occurrence.value.slice(0, 10);
      let anchorSequence = last.sequence;
      if (provider === 'mangaupdates' && this.operations !== undefined) {
        const observations = selected.flatMap((event) => {
          const chapter = Number(event.sequence);
          return event.occurrence.kind === 'DATE' && Number.isFinite(chapter) ? [{ chapter, releasedOn: event.occurrence.value }] : [];
        });
        const history = await this.operations.mergeObservations({ workId, observations, ownerToken: crypto.randomUUID(), now: checkedAt });
        const lifecycle = group.mapping.editorialStatus === 'UPCOMING' ? 'UNKNOWN' : group.mapping.editorialStatus ?? 'UNKNOWN';
        const prediction = predictNextMangaRelease(history, lifecycle);
        const latest = history.at(-1);
        if (latest !== undefined) { anchorDate = latest.releasedOn; anchorSequence = String(latest.chapter); }
        if (prediction !== undefined && latest !== undefined) intervalDays = (Date.parse(prediction.releasedOn) - Date.parse(latest.releasedOn)) / 86_400_000;
      }
      const explicitNext = provider === 'anilist' ? selected.find((event) => event.state === 'SCHEDULED') : undefined;
      const validity = {
        from: selected.map((event) => event.occurrence.value.slice(0, 10)).sort()[0] ?? window.from,
        to: selected.map((event) => event.expiresAt.slice(0, 10)).sort().at(-1) ?? window.to,
      };
      const semantic = { workId, provider, providerWorkId: last.providerWorkId, releaseKind: last.releaseKind, anchorDate, anchorSequence, intervalDays, explicitNextId: explicitNext?.id, events: semanticAgendaEvents(selected), editorialStatus: group.mapping.editorialStatus ?? 'UNKNOWN', source: last.provenance.source, parserVersion: last.provenance.parserVersion, rulesVersion: last.provenance.rulesVersion };
      const modelDigest = await sha256(JSON.stringify(semantic));
      if (digests.get(workId) === modelDigest) continue;
      changedWorkIds.push(workId);
      if (statements.length === 0) statements.push(this.db.prepare('INSERT OR IGNORE INTO catalogue_revisions(revision, published_at) VALUES (?1, ?2)').bind(revision, checkedAt));
      statements.push(this.db.prepare(`INSERT INTO catalogue_release_model(
        work_id, provider, provider_work_id, release_kind, anchor_date, anchor_sequence,
        interval_days, explicit_next_json, exceptions_json, valid_from, valid_to,
        editorial_status, source, observed_at, parser_version, rules_version, model_digest, revision)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)
        ON CONFLICT(work_id) DO UPDATE SET provider=excluded.provider, provider_work_id=excluded.provider_work_id,
        release_kind=excluded.release_kind, anchor_date=excluded.anchor_date, anchor_sequence=excluded.anchor_sequence,
        interval_days=excluded.interval_days, explicit_next_json=excluded.explicit_next_json,
        exceptions_json=excluded.exceptions_json, valid_from=excluded.valid_from, valid_to=excluded.valid_to,
        editorial_status=excluded.editorial_status, source=excluded.source, observed_at=excluded.observed_at,
        parser_version=excluded.parser_version, rules_version=excluded.rules_version,
        model_digest=excluded.model_digest, revision=excluded.revision
        WHERE catalogue_release_model.model_digest <> excluded.model_digest`)
        .bind(workId, provider, last.providerWorkId, last.releaseKind, anchorDate, anchorSequence ?? null,
          intervalDays ?? null, explicitNext === undefined ? null : JSON.stringify(explicitNext), JSON.stringify(selected),
          validity.from, validity.to, group.mapping.editorialStatus ?? 'UNKNOWN', last.provenance.source, checkedAt,
          last.provenance.parserVersion, last.provenance.rulesVersion, modelDigest, revision));
      const lastConfirmed = selected.filter((event) => event.state === 'CONFIRMED' && event.releaseKind !== 'special').at(-1);
      if (lastConfirmed !== undefined) {
        statements.push(this.db.prepare(`UPDATE catalogue_current_metadata SET
          last_confirmed_kind = ?1, last_confirmed_sequence = ?2, last_confirmed_on = ?3, revision = ?4
          WHERE work_id = ?5 AND (last_confirmed_on IS NULL OR last_confirmed_on <= ?3)`)
          .bind(lastConfirmed.releaseKind, lastConfirmed.sequence ?? null, lastConfirmed.occurrence.value.slice(0, 10), revision, workId));
      }
    }
    const expired = (await this.db.prepare(`SELECT work_id AS workId, model_digest AS modelDigest, revision,
      explicit_next_json AS explicitNextJson, exceptions_json AS exceptionsJson
      FROM catalogue_release_model
      WHERE valid_to < ?1 AND (explicit_next_json IS NOT NULL OR exceptions_json <> '[]')
      LIMIT 1000`).bind(checkedAt.slice(0, 10)).all<ExpiredAgendaModelRow>()).results;
    for (const stale of expired) {
      if (grouped.has(stale.workId) || changedWorkIds.includes(stale.workId)) continue;
      const modelDigest = await sha256(`${stale.modelDigest}|expired|${checkedAt.slice(0, 10)}`);
      if (statements.length === 0) statements.push(this.db.prepare('INSERT OR IGNORE INTO catalogue_revisions(revision, published_at) VALUES (?1, ?2)').bind(revision, checkedAt));
      statements.push(this.db.prepare(`UPDATE catalogue_release_model SET explicit_next_json = NULL,
        exceptions_json = '[]', model_digest = ?1, observed_at = ?2, revision = ?3
        WHERE work_id = ?4 AND model_digest = ?5`)
        .bind(modelDigest, checkedAt, revision, stale.workId, stale.modelDigest));
      changedWorkIds.push(stale.workId);
    }
    if (changedWorkIds.length > 0) statements.push(this.db.prepare(`UPDATE catalogue_works SET revision = ?1
      WHERE work_id IN (SELECT value FROM json_each(?2)) AND revision <> ?1`).bind(revision, JSON.stringify(changedWorkIds)));
    if (statements.length > 0) await this.db.batch(statements);
    const activeRevision = statements.length > 0 ? revision : Math.max(...existing.map((row) => row.revision));
    return { changed: statements.length > 0, revision: `models-${activeRevision}-${grouped.size}` };
  }

  private async pruneCompletedPages(): Promise<void> {
    if (this.operations !== undefined) return;
    await this.db.prepare(`DELETE FROM public_release_agenda_page
      WHERE NOT EXISTS (
        SELECT 1 FROM public_release_agenda_lane_state AS lane
        WHERE public_release_agenda_page.collection_id IN (lane.active_snapshot_id, lane.collection_id)
      )`).run();
  }

  private async readLaneEvents(provider: AgendaProvider): Promise<AgendaLaneEvents> {
    const state = await this.readLaneState(provider);
    if (state?.activeSnapshotId !== null && state?.activeSnapshotId !== undefined) {
      if (this.operations !== undefined) {
        const snapshot = await this.operations.readPageVersion(['snapshots', provider, state.activeSnapshotId].join('/'));
        if (snapshot === undefined || !snapshot.complete) throw new Error('agenda-staging-incomplete');
        const result: AgendaLaneEvents = { events: Object.freeze(snapshot.events) };
        if (state.windowFrom !== null && state.windowTo !== null) result.window = { from: state.windowFrom, to: state.windowTo };
        return result;
      }
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
