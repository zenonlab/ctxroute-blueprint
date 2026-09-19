import { agendaEntryId, createReminder, reminderId } from '@tobirink/domain';
import type { AgendaEntry, AgendaEntryId, Reminder, ReminderId } from '@tobirink/domain';
import type { NotificationPort } from '../ports/capability-ports';
import type { StorageReadPort } from '../ports/storage-port';
import type { StoragePort } from '../ports/storage-port';
import type { TaskStorePort } from '../tasks/task-store-port';
import type { DurableTask } from '../tasks/task-state';

const agendaNotificationKind = 'agenda-native-notification';

interface AgendaNotificationPayload {
  agendaEntryId: AgendaEntryId;
  reminderId: ReminderId;
}

function parsePayload(payload: string): AgendaNotificationPayload | undefined {
  const [entryIdValue, reminderIdValue, unexpected] = payload.split('\n');
  if (!entryIdValue || !reminderIdValue || unexpected !== undefined) return undefined;
  try {
    return { agendaEntryId: agendaEntryId(entryIdValue), reminderId: reminderId(reminderIdValue) };
  } catch {
    return undefined;
  }
}

export type AgendaReminderSchedule =
  | { state: 'not-scheduled' | 'prediction-only' }
  | { state: 'scheduled'; task: DurableTask };

export async function scheduleAgendaNotification(
  tasks: TaskStorePort,
  entry: AgendaEntry,
  reminder: Reminder,
): Promise<AgendaReminderSchedule> {
  if (!reminder.enabled || reminder.channel !== 'native' || entry.availability === 'unavailable') return { state: 'not-scheduled' };
  if (entry.availability === 'estimated') return { state: 'prediction-only' };

  const payload: AgendaNotificationPayload = { agendaEntryId: entry.id, reminderId: reminder.id };
  if (!entry.occursAt) return { state: 'not-scheduled' };
  const availableAt = new Date(new Date(entry.occursAt).getTime() - reminder.leadMinutes * 60_000).toISOString();
  const idempotencyKey = `agenda-notification:${reminder.id}:${entry.occursAt}`;
  const task = await tasks.schedule({
    id: idempotencyKey,
    idempotencyKey,
    kind: agendaNotificationKind,
    payload: `${payload.agendaEntryId}\n${payload.reminderId}`,
  }, availableAt);
  return { state: 'scheduled', task };
}

export async function scheduleAgendaPeriodNotifications(
  storage: StoragePort,
  tasks: TaskStorePort,
  entries: readonly AgendaEntry[],
): Promise<number> {
  let scheduled = 0;
  for (const entry of entries) {
    if (entry.availability !== 'official' && entry.availability !== 'confirmed') continue;
    const suffix = entry.id.replace(/^agenda_/u, '');
    const existing = await storage.getReminder(reminderId(`reminder_${suffix}`));
    const reminder = existing ?? createReminder({ agendaEntryId: entry.id, channel: 'native', enabled: true, id: reminderId(`reminder_${suffix}`), leadMinutes: 0 });
    if (existing === undefined) await storage.putReminder(reminder);
    if ((await scheduleAgendaNotification(tasks, entry, reminder)).state === 'scheduled') scheduled += 1;
  }
  return scheduled;
}

export async function resumeDueAgendaNotification(
  dependencies: { notifications: NotificationPort; storage: StorageReadPort; tasks: TaskStorePort; canNotify?: (entry: AgendaEntry) => Promise<boolean> },
  input: { claimExpiresAt: string; claimToken: string; now: string },
): Promise<'empty' | 'notifiable-entry-missing' | 'published'> {
  const task = await dependencies.tasks.claimNext(input.claimToken, input.now, input.claimExpiresAt);
  if (!task) return 'empty';
  if (task.kind !== agendaNotificationKind) {
    await dependencies.tasks.block(task.id, input.claimToken, 'Unsupported task kind.');
    return 'notifiable-entry-missing';
  }

  const payload = parsePayload(task.payload);
  const entry = payload ? await dependencies.storage.getAgendaEntry(payload.agendaEntryId) : undefined;
  const reminder = payload ? await dependencies.storage.getReminder(payload.reminderId) : undefined;
  if (!entry || !reminder || !reminder.enabled || reminder.channel !== 'native' || (entry.availability !== 'official' && entry.availability !== 'confirmed')) {
    await dependencies.tasks.block(task.id, input.claimToken, 'Native notification requires an official or confirmed entry.');
    return 'notifiable-entry-missing';
  }

  const effect = `agenda-notification:${reminder.id}:${entry.occursAt}`;
  if (task.idempotencyKey !== effect) {
    await dependencies.tasks.block(task.id, input.claimToken, 'Release date changed after this notification was scheduled.');
    return 'notifiable-entry-missing';
  }
  if (dependencies.canNotify !== undefined && !await dependencies.canNotify(entry)) {
    await dependencies.tasks.block(task.id, input.claimToken, 'Notification hidden by current local policy.');
    return 'notifiable-entry-missing';
  }
  await dependencies.notifications.publish({ body: entry.releaseLabel, deduplicationKey: effect, title: 'Sortie à venir' });
  await dependencies.tasks.recordEffect(task.id, input.claimToken, effect);
  await dependencies.tasks.commit(task.id, input.claimToken);
  return 'published';
}
