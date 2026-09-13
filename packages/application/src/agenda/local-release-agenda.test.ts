import { describe, expect, it } from 'vitest';
import { createWork, workId } from '@tobirink/domain';
import type { LocalAgendaEvent, LocalReleaseEvidence, WorkId } from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import type { PublicReleaseGeneration, PublicReleaseGenerationCachePort } from './public-release-generation';
import { projectLocalReleaseAgenda } from './local-release-agenda';
import type { LocalReleaseAgendaPort } from './local-release-agenda';

class MemoryGeneration implements PublicReleaseGenerationCachePort {
  constructor(public generation?: PublicReleaseGeneration) {}
  async load() { return this.generation; }
  async save(generation: PublicReleaseGeneration) { this.generation = generation; }
}

class MemoryProjection implements LocalReleaseAgendaPort {
  evidence = new Map<string, LocalReleaseEvidence>();
  events: LocalAgendaEvent[] = [];
  revision?: string;
  async commit(revision: string, evidence: readonly LocalReleaseEvidence[], events: readonly LocalAgendaEvent[]) {
    for (const item of evidence) this.evidence.set(item.id, item);
    this.events = [...events];
    this.revision = revision;
  }
  async isCurrent(revision: string) { return this.revision === revision; }
  async listEvidence(id: WorkId, limit: number) {
    return [...this.evidence.values()].filter((item) => item.workId === id).sort((a, b) => a.occurrence.value.localeCompare(b.occurrence.value)).slice(-limit);
  }
  async listPeriod(from: string, to: string, limit: number) {
    return this.events.filter((item) => item.occurrence.value >= from && item.occurrence.value < to).slice(0, limit);
  }
}

const generation = (events: PublicReleaseGeneration['events'], revision = 'agenda-test'): PublicReleaseGeneration => ({
  etag: `"${revision}"`, events, generatedAt: '2026-09-13T00:00:00.000Z', revision, source: 'shared', window: { from: '2026-09-12', to: '2026-09-28' },
});
const mangaRelease = (chapter: number, releasedOn: string) => ({
  expiresAt: '2026-11-12T00:00:00.000Z', id: `mangaupdates-77-${chapter}`, occurrence: { kind: 'DATE' as const, value: releasedOn }, provenance: { fetchedAt: `${releasedOn}T12:00:00.000Z`, parserVersion: '2', rulesVersion: '2', source: 'mangaupdates' }, provider: 'mangaupdates' as const, providerWorkId: '77', releaseKind: 'chapter' as const, sequence: String(chapter), state: 'CONFIRMED' as const,
});

describe('local release Agenda projection', () => {
  it('keeps MangaUpdates dates civil, predicts one next date, and never schedules it', async () => {
    const storage = new MemoryStoragePort();
    const id = workId('work_manga-agenda');
    await storage.putWork(createWork({ externalReferences: [{ externalId: '77', provider: 'mangaUpdates' }], id, mediaKind: 'manga', preferredTitle: 'Manga' }));
    const projection = new MemoryProjection();
    const result = await projectLocalReleaseAgenda(storage, new MemoryGeneration(generation([mangaRelease(1, '2026-09-01'), mangaRelease(2, '2026-09-08'), mangaRelease(3, '2026-09-15'), mangaRelease(4, '2026-09-22')])), projection);
    expect(result.entries).toEqual([]);
    expect(projection.events.filter((event) => event.availability === 'estimated')).toEqual([expect.objectContaining({ occurrence: { kind: 'DATE', value: '2026-09-29' } })]);
    expect(projection.events.filter((event) => event.availability === 'confirmed')).toHaveLength(4);
  });

  it('replaces the matching estimate when a confirmed date arrives', async () => {
    const storage = new MemoryStoragePort();
    const id = workId('work_manga-confirm');
    await storage.putWork(createWork({ externalReferences: [{ externalId: '77', provider: 'mangaupdates' }], id, mediaKind: 'manga', preferredTitle: 'Manga' }));
    const projection = new MemoryProjection();
    const cache = new MemoryGeneration(generation([mangaRelease(1, '2026-09-01'), mangaRelease(2, '2026-09-08'), mangaRelease(3, '2026-09-15'), mangaRelease(4, '2026-09-22')]));
    await projectLocalReleaseAgenda(storage, cache, projection);
    cache.generation = generation([mangaRelease(5, '2026-09-29')], 'agenda-test-2');
    await projectLocalReleaseAgenda(storage, cache, projection);
    expect(projection.events).toEqual(expect.arrayContaining([expect.objectContaining({ availability: 'confirmed', occurrence: { kind: 'DATE', value: '2026-09-29' } }), expect.objectContaining({ availability: 'estimated', occurrence: { kind: 'DATE', value: '2026-10-06' } })]));
    expect(projection.events.filter((event) => event.occurrence.value === '2026-09-29')).toHaveLength(1);
  });

  it('returns only resolved AniList instants to notification scheduling and ignores unknown public identities', async () => {
    const storage = new MemoryStoragePort();
    await storage.putWork(createWork({ externalReferences: [{ externalId: '42', provider: 'anilist' }], id: workId('work_anime-agenda'), mediaKind: 'anime', preferredTitle: 'Anime' }));
    const anime = { expiresAt: '2026-11-12T00:00:00.000Z', id: 'anilist-42-1', occurrence: { kind: 'INSTANT' as const, value: '2026-09-13T18:00:00.000Z' }, provenance: { fetchedAt: '2026-09-13T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'anilist' }, provider: 'anilist' as const, providerWorkId: '42', releaseKind: 'episode' as const, sequence: '1', state: 'SCHEDULED' as const };
    const unknown = { ...anime, id: 'anilist-404-1', providerWorkId: '404' };
    const result = await projectLocalReleaseAgenda(storage, new MemoryGeneration(generation([anime, unknown])), new MemoryProjection());
    expect(result.entries).toHaveLength(1);
    expect(result.missingWorkIds).toEqual([]);
  });

  it('reuses an already projected revision without scanning Works again', async () => {
    const storage = new MemoryStoragePort();
    await storage.putWork(createWork({ externalReferences: [{ externalId: '42', provider: 'anilist' }], id: workId('work_anime-current'), mediaKind: 'anime', preferredTitle: 'Anime' }));
    const anime = { expiresAt: '2026-11-12T00:00:00.000Z', id: 'anilist-42-current', occurrence: { kind: 'INSTANT' as const, value: '2026-09-13T18:00:00.000Z' }, provenance: { fetchedAt: '2026-09-13T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'anilist' }, provider: 'anilist' as const, providerWorkId: '42', releaseKind: 'episode' as const, sequence: '1', state: 'SCHEDULED' as const };
    const projection = new MemoryProjection();
    const cache = new MemoryGeneration(generation([anime]));
    await projectLocalReleaseAgenda(storage, cache, projection);
    storage.listWorks = async () => { throw new Error('unexpected-work-scan'); };
    await expect(projectLocalReleaseAgenda(storage, cache, projection)).resolves.toMatchObject({ entries: [{ releaseLabel: 'episode 1' }], state: 'hydrated' });
  });
});
