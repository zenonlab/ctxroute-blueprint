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

export function reconcileProgressObservation(explicit: Progress, value: number): Pick<ObservedProgress, 'explicit' | 'relation'> {
  const relation = value > explicit.value ? 'ahead' : value < explicit.value ? 'regression' : 'equal';
  return {
    explicit: relation === 'ahead' ? updateProgress(explicit, value) : explicit,
    relation,
  };
}

export async function observeProgress(
  storage: StoragePort,
  observation: ProgressObservation,
): Promise<ObservedProgress> {
  const frozenObservation = Object.freeze({ ...observation });

  return storage.transaction(['progress'], async (session) => {
    const current = await session.getProgress(observation.progressId);
    if (!current) throw new Error(`Explicit progress ${observation.progressId} was not found.`);
    const { explicit, relation } = reconcileProgressObservation(current, observation.value);
    if (relation === 'ahead') await session.putProgress(explicit);

    return { explicit, observation: frozenObservation, relation };
  });
}
