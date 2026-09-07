import { createFavoriteParseArtifactRecord, restoreDurableTask } from '@tobirink/application';
import type { PrivateStoreName, StorageSession } from '@tobirink/application';
import type { FavoriteSourceId } from '@tobirink/domain';
import type { TobirinkDatabase } from '../database';

type FavoriteResolutionSession = Pick<StorageSession, 'getFavoriteParseArtifact' | 'getFavoriteResolutionTask' | 'putFavoriteParseArtifact' | 'putFavoriteResolutionTask'>;

export function createDexieFavoriteResolutionSession(database: TobirinkDatabase, requireStore: (store: PrivateStoreName) => void): FavoriteResolutionSession {
  return {
    getFavoriteParseArtifact: async (sourceId: FavoriteSourceId) => { requireStore('favoriteArtifacts'); const record = await database.favoriteArtifacts.get(sourceId); return record && createFavoriteParseArtifactRecord(record); },
    getFavoriteResolutionTask: async (id: string) => { requireStore('favoriteResolutionTasks'); const task = await database.favoriteResolutionTasks.get(id); return task && restoreDurableTask(task); },
    putFavoriteParseArtifact: async (record) => { requireStore('favoriteArtifacts'); await database.favoriteArtifacts.put(createFavoriteParseArtifactRecord(record)); },
    putFavoriteResolutionTask: async (task) => { requireStore('favoriteResolutionTasks'); await database.favoriteResolutionTasks.put(restoreDurableTask(task)); },
  };
}
