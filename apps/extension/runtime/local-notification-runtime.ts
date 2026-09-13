import { resumeDueAgendaNotification } from '@tobirink/application';
import type { QuickPreferencesPort, StorageReadPort, TaskStorePort } from '@tobirink/application';
import type { NotificationPort } from '@tobirink/application';

export const reminderAlarmName = 'tobirink-due-reminders';
export const reminderAlarmPeriodMinutes = 1;
export const agendaNextAlarmName = 'tobirink-agenda-next';
export const agendaReconcileAlarmName = 'tobirink-agenda-reconcile';
export const agendaReconcileAlarmPeriodMinutes = 360;
const maximumNotificationsPerWake = 20;

export async function drainDueAgendaNotifications(
  dependencies: { notifications: NotificationPort; preferences: QuickPreferencesPort; storage: StorageReadPort; tasks: TaskStorePort },
  now: Date,
): Promise<number> {
  if (!(await dependencies.preferences.read()).nativeNotifications) return 0;
  let published = 0;
  for (let index = 0; index < maximumNotificationsPerWake; index += 1) {
    const instant = now.toISOString();
    const result = await resumeDueAgendaNotification(
      dependencies,
      { claimExpiresAt: new Date(now.getTime() + 60_000).toISOString(), claimToken: `${instant}:${index}`, now: instant },
    );
    if (result === 'empty') break;
    if (result === 'published') published += 1;
  }
  return published;
}
