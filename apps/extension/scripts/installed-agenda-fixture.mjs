export function installedAgendaFixture(reference = new Date()) {
  const start = new Date(reference); start.setUTCDate(start.getUTCDate() - 1);
  const end = new Date(reference); end.setUTCDate(end.getUTCDate() + 15);
  const date = reference.toISOString().slice(0, 10);
  const nextDay = new Date(`${date}T00:00:00.000Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return {
    active: { activeGeneration: 'installed-agenda', checkedAt: reference.toISOString(), etag: '"installed-agenda"', generation: 1, id: 'active', revision: 'installed-agenda', source: 'shared', window: { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) } },
    events: [
      { expiresAt: end.toISOString(), id: 'installed-anilist-42-1', occurrence: { kind: 'INSTANT', value: `${date}T18:00:00.000Z` }, provenance: { fetchedAt: reference.toISOString(), parserVersion: '2', rulesVersion: '2', source: 'anilist' }, provider: 'anilist', providerWorkId: '42', releaseKind: 'episode', sequence: '1', state: 'SCHEDULED' },
      { expiresAt: end.toISOString(), id: 'installed-mangaupdates-77-58', occurrence: { kind: 'DATE', value: date }, provenance: { fetchedAt: reference.toISOString(), parserVersion: '2', rulesVersion: '2', source: 'mangaupdates' }, provider: 'mangaupdates', providerWorkId: '77', releaseKind: 'chapter', sequence: '58.5', state: 'CONFIRMED' },
    ],
    period: { from: `${date}T00:00:00.000Z`, to: nextDay.toISOString() },
    works: [
      { externalReferences: [{ externalId: '42', provider: 'anilist' }], id: 'work_installed-anime', mediaKind: 'anime', preferredTitle: 'Installed anime' },
      { externalReferences: [{ externalId: '77', provider: 'mangaupdates' }], id: 'work_installed-manga', mediaKind: 'manga', preferredTitle: 'Installed manga' },
    ],
  };
}

export function seedInstalledAgenda(fixture) {
  return new Promise((resolve, reject) => {
    const opening = globalThis.indexedDB.open('tobirink-private');
    opening.onerror = () => reject(new Error('Agenda database unavailable.'));
    opening.onsuccess = () => {
      const database = opening.result;
      const transaction = database.transaction(['works', 'publicReleaseEvents', 'publicReleaseSyncState', 'localAgendaProjectionState'], 'readwrite');
      const works = transaction.objectStore('works');
      const events = transaction.objectStore('publicReleaseEvents');
      const state = transaction.objectStore('publicReleaseSyncState');
      transaction.objectStore('localAgendaProjectionState').clear();
      fixture.works.forEach((work) => works.put(work));
      fixture.events.forEach((event) => events.put(event));
      state.put(fixture.active);
      transaction.oncomplete = () => { database.close(); resolve(true); };
      transaction.onerror = () => { database.close(); reject(transaction.error ?? new Error('Agenda seed failed.')); };
    };
  });
}

export const installedAgendaSeedScript = `return (${seedInstalledAgenda.toString()})(arguments[0]);`;
