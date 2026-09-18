import { agendaEntryId, createAgendaEntry, predictNextMangaRelease, workId } from '@tobirink/domain';
import type { ReleaseLifecycleStatus } from '@tobirink/domain';
import type { AgendaEntry, FavoriteSource, LocalAgendaEvent, LocalReleaseEvidence, Work, WorkId } from '@tobirink/domain';
import type { StoragePort, StorageReadPort } from '../ports/storage-port';
import type { PublicReleaseGenerationCachePort } from './public-release-generation';
import { localAgendaEventSchema, localReleaseEvidenceSchema } from '../releases/release-contracts';

export interface LocalReleaseAgendaPort {
  commit(revision: string, evidence: readonly LocalReleaseEvidence[], events: readonly LocalAgendaEvent[]): Promise<void>;
  isCurrent(revision: string): Promise<boolean>;
  listEvidence(workId: WorkId, limit: number): Promise<readonly LocalReleaseEvidence[]>;
  listPeriod(from: string, to: string, limit: number): Promise<readonly LocalAgendaEvent[]>;
}

function canonicalProvider(provider: string): string {
  return provider === 'mangaUpdates' ? 'mangaupdates' : provider;
}

async function allWorks(storage: StorageReadPort): Promise<readonly Work[]> {
  const works: Work[] = []; let afterId: WorkId | undefined;
  for (let page = 0; page < 100; page += 1) { const batch = await storage.listWorks(afterId ? { afterId, limit: 100 } : { limit: 100 }); works.push(...batch); if (batch.length < 100) return works; afterId = batch.at(-1)?.id; }
  throw new Error('local-agenda-work-pagination-limit');
}

function numericSequence(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+(?:\.\d+)?$/u.test(value)) return undefined;
  const parsed = Number(value); return Number.isFinite(parsed) ? parsed : undefined;
}

function releaseLifecycle(work: Work): ReleaseLifecycleStatus {
  const status = work.hydration?.candidate.editorialStatus;
  if (status === 'COMPLETED' || status === 'CANCELLED' || status === 'ONGOING' || status === 'HIATUS') return status;
  return 'UNKNOWN';
}

function notifiableEntries(events: readonly LocalAgendaEvent[]): readonly AgendaEntry[] {
  return Object.freeze(events.flatMap((event) => event.occurrence.kind === 'INSTANT' && event.availability !== 'estimated' ? [createAgendaEntry({ availability: event.availability, id: agendaEntryId(`agenda_${event.id}`), occursAt: event.occurrence.value, releaseLabel: event.releaseLabel, workId: workId(event.workId) })] : []));
}

export async function projectLocalReleaseAgenda(storage: StoragePort, cache: PublicReleaseGenerationCachePort, projection: LocalReleaseAgendaPort): Promise<{ entries: readonly AgendaEntry[]; generatedAt?: string; missingWorkIds: readonly WorkId[]; state: 'empty' | 'hydrated' }> {
  const generation = await cache.load();
  if (!generation) return { entries: [], missingWorkIds: [], state: 'empty' };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([generation.revision, generation.window])));
  const projectionRevision = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (await projection.isCurrent(projectionRevision)) {
    const events = await projection.listPeriod(generation.window.from, generation.window.to, 100);
    return { entries: notifiableEntries(events), generatedAt: generation.generatedAt, missingWorkIds: [], state: 'hydrated' };
  }
  const works = await allWorks(storage); const identities: { [identity: string]: Work | undefined } = {};
  for (const work of works) for (const reference of work.externalReferences) identities[`${canonicalProvider(reference.provider)}:${reference.externalId}`] = work;
  const evidence: LocalReleaseEvidence[] = []; const events: LocalAgendaEvent[] = []; const mangaWorks = new Map<WorkId, Work>();
  for (const release of generation.events) {
    const identity = `${release.provider}:${release.providerWorkId}`; const work = identities[identity];
    if (!work) continue;
    const evidenceRecord = localReleaseEvidenceSchema.parse({ id: `evidence_${release.id}`.slice(0, 128), observedAt: release.provenance.fetchedAt, occurrence: release.occurrence, provider: release.provider, providerWorkId: release.providerWorkId, publicReleaseId: release.id, releaseKind: release.releaseKind, sequence: release.sequence, source: 'public', state: release.state, workId: work.id });
    evidence.push(evidenceRecord);
    if (release.state !== 'CANCELLED') events.push(localAgendaEventSchema.parse({ availability: release.state === 'ESTIMATED' ? 'estimated' : release.provider === 'mangaupdates' ? 'confirmed' : 'official', evidenceId: evidenceRecord.id, id: `agenda_${release.id}`.slice(0, 128), occurrence: release.occurrence, releaseLabel: `${release.releaseKind} ${release.sequence ?? ''}`.trim(), workId: work.id }));
    if (work.mediaKind === 'manga') mangaWorks.set(work.id, work);
  }
  for (const [id] of mangaWorks) {
    if (generation.models !== undefined || evidence.some(item => item.workId === id && (item.state === 'SCHEDULED' || item.state === 'CANCELLED'))) continue;
    const previous = await projection.listEvidence(id, 12);
    const observations = [...previous, ...evidence.filter((item) => item.workId === id)].flatMap((item) => { const chapter = item.releaseKind === 'chapter' ? numericSequence(item.sequence) : undefined; return chapter !== undefined && item.occurrence.kind === 'DATE' && item.state === 'CONFIRMED' ? [{ chapter, releasedOn: item.occurrence.value }] : []; });
    const prediction = predictNextMangaRelease(observations, releaseLifecycle(mangaWorks.get(id)!));
    const last = evidence.filter((item) => item.workId === id).at(-1) ?? previous.at(-1);
    if (prediction && last && !events.some((event) => event.workId === id && event.occurrence.kind === 'DATE' && event.occurrence.value === prediction.releasedOn && event.availability !== 'estimated')) events.push(localAgendaEventSchema.parse({ availability: 'estimated', evidenceId: last.id, id: `agenda_prediction_${id}`.slice(0, 128), occurrence: { kind: 'DATE', value: prediction.releasedOn }, releaseLabel: 'Prochaine sortie estimée', workId: id }));
  }
  await projection.commit(projectionRevision, evidence, events);
  return { entries: notifiableEntries(events), generatedAt: generation.generatedAt, missingWorkIds: Object.freeze([]), state: 'hydrated' };
}

function compareSources(left: FavoriteSource, right: FavoriteSource): number { return left.folderPath.join('\u0000').localeCompare(right.folderPath.join('\u0000')) || left.order - right.order || left.id.localeCompare(right.id); }
async function sourceFor(storage: StorageReadPort, id: WorkId): Promise<FavoriteSource | undefined> { const direct = await storage.listFavoriteSourcesByWorkId({ limit: 100, workId: id }); return direct.filter((source) => source.presence === 'observed').sort(compareSources)[0]; }
export async function readLocalReleaseAgenda(storage: StorageReadPort, projection: LocalReleaseAgendaPort, period: { from: string; to: string }): Promise<{ items: readonly { event: LocalAgendaEvent; source?: FavoriteSource; work: Work }[]; missingWorkIds: readonly WorkId[] }> {
  const events = await projection.listPeriod(period.from.slice(0, 10), period.to.slice(0, 10), 100); const missing: WorkId[] = []; const items: { event: LocalAgendaEvent; source?: FavoriteSource; work: Work }[] = [];
  for (const event of events) { const id = workId(event.workId); const work = await storage.getWork(id); if (!work) { missing.push(id); continue; } const source = await sourceFor(storage, id); items.push(source ? { event, source, work } : { event, work }); }
  return { items: Object.freeze(items), missingWorkIds: Object.freeze(missing) };
}
