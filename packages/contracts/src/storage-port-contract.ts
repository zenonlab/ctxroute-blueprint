import type { StoragePort } from '@tobirink/application';
import { createLibrary, createProgress, createWork, libraryId, progressId, workId } from '@tobirink/domain';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`StoragePort contract failed: ${message}`);
}

export async function verifyStoragePortContract(createStorage: () => Promise<StoragePort> | StoragePort) {
  const storage = await createStorage();
  const id = workId('work_contract');
  const work = createWork({ externalReferences: [], id, mediaKind: 'manga', preferredTitle: 'Contract work' });
  const library = createLibrary(libraryId('library_contract'), [id]);
  const progress = createProgress({ id: progressId('progress_contract'), kind: 'chapter', value: 12, workId: id });

  await storage.transaction(['works', 'libraries', 'progress'], async (session) => {
    await session.putWork(work);
    await session.putLibrary(library);
    await session.putProgress(progress);
  });
  assert((await storage.getWork(id))?.preferredTitle === 'Contract work', 'work round-trip');
  assert((await storage.getLibrary(library.id))?.workIds[0] === id, 'library round-trip');
  assert((await storage.getProgress(progress.id))?.value === 12, 'progress round-trip');

  let scopeRejected = false;
  try {
    await storage.transaction(['works'], async (session) => session.putLibrary(library));
  } catch {
    scopeRejected = true;
  }
  assert(scopeRejected, 'writes outside a declared aggregate scope must fail');

  try {
    await storage.transaction(['works'], async (session) => {
      await session.putWork(createWork({ ...work, preferredTitle: 'Rolled back' }));
      throw new Error('interrupt transaction');
    });
  } catch {
    // Expected contract interruption.
  }
  assert((await storage.getWork(id))?.preferredTitle === 'Contract work', 'interrupted transaction rollback');
}
