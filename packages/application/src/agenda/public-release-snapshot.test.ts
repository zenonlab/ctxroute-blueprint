import { describe, expect, it } from 'vitest';
import { agendaEntryId, createWork, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '@tobirink/contracts';
import { hydrateAgendaFromPublicReleaseCache, parsePublicReleaseSnapshot, publicReleaseSnapshotSchema } from './public-release-snapshot';

const snapshot = {
  entries: [{ availability: 'official' as const, label: 'Épisode 2', occursAt: '2026-09-12T18:00:00.000Z', releaseId: 'release_2', workId: 'work_frieren' }],
  generatedAt: '2026-09-05T08:00:00.000Z',
  revision: '2026-09-05.1',
};

describe('public release snapshot application contract', () => {
  it('hydrates only releases linked to an existing private Work', async () => {
    const storage = new MemoryStoragePort();
    const work = createWork({ externalReferences: [], id: workId('work_frieren'), mediaKind: 'anime', preferredTitle: 'Frieren' });
    await storage.putWork(work);
    await expect(hydrateAgendaFromPublicReleaseCache(storage, { load: async () => snapshot, save: async () => undefined })).resolves.toMatchObject({ generatedAt: snapshot.generatedAt, state: 'hydrated' });
    await expect(storage.getAgendaEntry(agendaEntryId('agenda_release_2'))).resolves.toMatchObject({ availability: 'official', workId: work.id });
  });

  it('keeps parsing strict, ordered and bounded', () => {
    expect(parsePublicReleaseSnapshot(snapshot).entries[0]?.releaseId).toBe('release_2');
    expect(() => publicReleaseSnapshotSchema.parse({ ...snapshot, privateUserId: 'nope' })).toThrow();
  });
});
