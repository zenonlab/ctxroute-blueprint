import type { AgendaEntryId, ReminderId } from './identity';
import { invariant, nonNegativeNumber } from './invariant';

export type ReminderChannel = 'badge' | 'native';

export interface Reminder {
  agendaEntryId: AgendaEntryId;
  channel: ReminderChannel;
  enabled: boolean;
  id: ReminderId;
  leadMinutes: number;
}

export function createReminder(input: Reminder): Reminder {
  const leadMinutes = nonNegativeNumber(input.leadMinutes, 'leadMinutes');
  invariant(Number.isInteger(leadMinutes), 'invalid-number', 'leadMinutes must be an integer.');
  return Object.freeze({ ...input, leadMinutes });
}
