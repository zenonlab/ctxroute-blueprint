import { updateProgress } from '@tobirink/domain';
import type { Progress, ProgressId } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';

export interface ProgressObservation {
  observedAt: string;
  progressId: ProgressId;
  value: number;
}

export interface ObservedProgress {
  explicit: Progress;
  observation: ProgressObservation;
  relation: 'ahead' | 'equal' | 'regression';
}

export async function observeProgress(
  storage: StoragePort,
  observation: ProgressObservation,
): Promise<ObservedProgress> {
  const frozenObservation = Object.freeze({ ...observation });

  return storage.transaction(['progress'], async (session) => {
    const current = await session.getProgress(observation.progressId);
    if (!current) throw new Error(`Explicit progress ${observation.progressId} was not found.`);
    const relation = observation.value > current.value ? 'ahead' : observation.value < current.value ? 'regression' : 'equal';
    const explicit = relation === 'ahead' ? updateProgress(current, observation.value) : current;
    if (relation === 'ahead') await session.putProgress(explicit);

    return { explicit, observation: frozenObservation, relation };
  });
}
