import { describe, expect, it } from 'vitest';
import { agendaEntryId, createAgendaEntry, createWork, workId } from '@tobirink/domain';
import { MemoryStoragePort } from '../../../contracts/src/memory-storage-port';
import { readAgendaPeriod } from './read-agenda-period';

describe('readAgendaPeriod', () => {
  it('joins bounded ordered entries and reports missing works', async () => {
    const storage = new MemoryStoragePort();
    const presentId = workId('work_agenda-present');
    const missingId = workId('work_agenda-missing');
    await storage.putWork(createWork({ externalReferences: [], id: presentId, mediaKind: 'anime', preferredTitle: 'Present' }));
    await storage.putAgendaEntry(createAgendaEntry({ availability: 'official', id: agendaEntryId('agenda_present'), occursAt: '2026-09-07T10:00:00.000Z', releaseLabel: 'Episode 1', workId: presentId }));
    await storage.putAgendaEntry(createAgendaEntry({ availability: 'estimated', id: agendaEntryId('agenda_missing'), occursAt: '2026-09-08T10:00:00.000Z', releaseLabel: 'Episode 2', workId: missingId }));

    const snapshot = await readAgendaPeriod(storage, { from: '2026-09-07T00:00:00.000Z', to: '2026-09-14T00:00:00.000Z' });
    expect(snapshot.items.map(({ work }) => work.id)).toEqual([presentId]);
    expect(snapshot.missingWorkIds).toEqual([missingId]);
  });

  it('uses a half-open period and rejects invalid bounds', async () => {
    const storage = new MemoryStoragePort();
    const id = workId('work_agenda-boundary');
    await storage.putAgendaEntry(createAgendaEntry({ availability: 'confirmed', id: agendaEntryId('agenda_boundary'), occursAt: '2026-09-14T00:00:00.000Z', releaseLabel: 'Boundary', workId: id }));
    await expect(readAgendaPeriod(storage, { from: '2026-09-07T00:00:00.000Z', to: '2026-09-14T00:00:00.000Z' })).resolves.toEqual({ items: [], missingWorkIds: [] });
    await expect(readAgendaPeriod(storage, { from: 'invalid', to: '2026-09-14T00:00:00.000Z' })).rejects.toThrow(/canonical ISO/u);
  });
});
