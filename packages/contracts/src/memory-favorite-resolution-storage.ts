import { createFavoriteParseArtifactRecord, restoreDurableTask } from '@tobirink/application';
import type { DurableTask, FavoriteParseArtifactRecord, PrivateStoreName, StorageSession } from '@tobirink/application';

type FavoriteResolutionSession = Pick<StorageSession, 'getFavoriteParseArtifact' | 'getFavoriteResolutionTask' | 'putFavoriteParseArtifact' | 'putFavoriteResolutionTask'>;

export interface MemoryFavoriteResolutionState {
  favoriteArtifacts: Map<string, FavoriteParseArtifactRecord>;
  favoriteResolutionTasks: Map<string, DurableTask>;
}

export function createMemoryFavoriteResolutionSession(state: MemoryFavoriteResolutionState, requireStore: (store: PrivateStoreName) => void): FavoriteResolutionSession {
  return {
    getFavoriteParseArtifact: async (sourceId) => { requireStore('favoriteArtifacts'); const record = state.favoriteArtifacts.get(sourceId); return record && createFavoriteParseArtifactRecord(record); },
    getFavoriteResolutionTask: async (id) => { requireStore('favoriteResolutionTasks'); const task = state.favoriteResolutionTasks.get(id); return task && restoreDurableTask(task); },
    putFavoriteParseArtifact: async (record) => { requireStore('favoriteArtifacts'); state.favoriteArtifacts.set(record.sourceId, createFavoriteParseArtifactRecord(record)); },
    putFavoriteResolutionTask: async (task) => { requireStore('favoriteResolutionTasks'); state.favoriteResolutionTasks.set(task.id, restoreDurableTask(task)); },
  };
}
