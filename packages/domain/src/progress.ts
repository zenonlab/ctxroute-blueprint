import type { ProgressId, WorkId } from './identity';
import { invariant, nonNegativeNumber } from './invariant';

export type ProgressKind = 'chapter' | 'episode' | 'volume';

export interface Progress {
  id: ProgressId;
  kind: ProgressKind;
  maximum?: number;
  value: number;
  workId: WorkId;
}

export function createProgress(input: Progress): Progress {
  const value = nonNegativeNumber(input.value, 'progress.value');
  if (input.maximum !== undefined) {
    const maximum = nonNegativeNumber(input.maximum, 'progress.maximum');
    invariant(value <= maximum, 'invalid-number', 'Progress cannot exceed its known maximum.');
  }
  return Object.freeze({ ...input, value });
}

export function updateProgress(progress: Progress, value: number, allowRegression = false): Progress {
  nonNegativeNumber(value, 'progress.value');
  invariant(allowRegression || value >= progress.value, 'invalid-number', 'A progress regression requires explicit confirmation.');
  return createProgress({ ...progress, value });
}
