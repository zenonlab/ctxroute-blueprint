import { resumeDueAgendaNotification } from '@tobirink/application';
import { isContentVisible } from '@tobirink/domain';
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
      { ...dependencies, canNotify: async (entry) => {
        const preferences = await dependencies.preferences.read();
        const work = await dependencies.storage.getWork(entry.workId);
        return preferences.nativeNotifications && isContentVisible(work?.hydration?.candidate, preferences.showAdultContent);
      } },
      { claimExpiresAt: new Date(now.getTime() + 60_000).toISOString(), claimToken: `${instant}:${index}`, now: instant },
    );
    if (result === 'empty') break;
    if (result === 'published') published += 1;
  }
  return published;
}

export async function refreshAndDrainAgendaNotifications(
  dependencies: Parameters<typeof drainDueAgendaNotifications>[0],
  refresh: () => Promise<void>,
  now: Date,
): Promise<{ published: number; refreshed: boolean }> {
  let refreshed = true;
  try { await refresh(); } catch { refreshed = false; }
  return { published: await drainDueAgendaNotifications(dependencies, now), refreshed };
}
