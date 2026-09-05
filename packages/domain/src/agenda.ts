import type { AgendaEntryId, WorkId } from './identity';
import { canonicalDateTime, invariant, requiredText } from './invariant';

export type AgendaAvailability = 'confirmed' | 'estimated' | 'official' | 'unavailable';

export interface AgendaEntry {
  availability: AgendaAvailability;
  id: AgendaEntryId;
  occursAt?: string;
  releaseLabel: string;
  workId: WorkId;
}

export function createAgendaEntry(input: AgendaEntry): AgendaEntry {
  const unavailable = input.availability === 'unavailable';
  invariant(unavailable === (input.occursAt === undefined), 'invalid-agenda-date', 'Unavailable agenda entries omit a date; every other entry requires one.');
  if (input.occursAt !== undefined) canonicalDateTime(input.occursAt, 'occursAt');
  return Object.freeze({ ...input, releaseLabel: requiredText(input.releaseLabel, 'releaseLabel') });
}
