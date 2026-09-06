import { searchLocalLibrary } from '@tobirink/application';
import type { StoragePort } from '@tobirink/application';
import type { LibraryId } from '@tobirink/domain';

export async function readLocalSearchSnapshot(storage: StoragePort, libraryId: LibraryId, query: string) {
  const snapshot = await searchLocalLibrary(storage, { libraryId, query });
  return {
    items: snapshot.items.map((work) => ({
      id: work.id,
      mediaType: work.mediaKind,
      source: work.externalReferences[0]?.provider ?? work.mediaKind,
      title: work.preferredTitle,
    })),
    truncated: snapshot.truncated,
  };
}
