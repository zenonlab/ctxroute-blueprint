import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  blockTask,
  claimTask,
  commitTask,
  createDurableTask,
  createScheduledDurableTask,
  isTaskAvailable,
  recordTaskEffect,
  resumeDueAgendaNotification,
  retryTask,
  scheduleAgendaNotification,
  scheduleAgendaPeriodNotifications,
} from '../../packages/application/src';
import type { DurableTask, TaskStorePort } from '../../packages/application/src';
import { WebExtensionNotificationAdapter } from '../../packages/adapters-browser/src';
import { MemoryStoragePort } from '../../packages/contracts/src/memory-storage-port';
import { agendaEntryId, createAgendaEntry, createReminder, reminderId, workId } from '../../packages/domain/src';
import { drainDueAgendaNotifications, reminderAlarmName } from './runtime/local-notification-runtime';

class MemoryTaskStore implements TaskStorePort {
  private readonly records = new Map<string, DurableTask>();

  private require(id: string): DurableTask {
    const task = this.records.get(id);
    if (!task) throw new Error(`Missing task ${id}.`);
    return task;
  }

  async enqueue(input: Pick<DurableTask, 'id' | 'idempotencyKey' | 'kind' | 'payload'>) {
    const existing = [...this.records.values()].find((task) => task.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
    const task = createDurableTask(input);
    this.records.set(task.id, task);
    return task;
  }

  async schedule(input: Pick<DurableTask, 'id' | 'idempotencyKey' | 'kind' | 'payload'>, availableAt: string) {
    const existing = [...this.records.values()].find((task) => task.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
    const task = createScheduledDurableTask(input, availableAt);
    this.records.set(task.id, task);
    return task;
  }

  async get(id: string) { return this.records.get(id); }

  async claimNext(token: string, claimedAt: string, expiresAt: string) {
    const task = [...this.records.values()].filter((candidate) => isTaskAvailable(candidate, claimedAt)).sort((left, right) => left.id.localeCompare(right.id))[0];
    if (!task) return undefined;
    const claimed = claimTask(task, token, claimedAt, expiresAt);
    this.records.set(task.id, claimed);
    return claimed;
  }

  async recordEffect(id: string, token: string, effect: string) {
    const task = recordTaskEffect(this.require(id), token, effect);
    this.records.set(id, task);
    return task;
  }

  async commit(id: string, token: string) {
    const task = commitTask(this.require(id), token);
    this.records.set(id, task);
    return task;
  }

  async retry(id: string, token: string, retryAt: string) {
    const task = retryTask(this.require(id), token, retryAt);
    this.records.set(id, task);
    return task;
  }

  async block(id: string, token: string, reason: string) {
    const task = blockTask(this.require(id), token, reason);
    this.records.set(id, task);
    return task;
  }
}

describe('agenda notifications', () => {
  it('preserves a manually disabled reminder when a public period is projected again', async () => {
    const storage = new MemoryStoragePort();
    const tasks = new MemoryTaskStore();
    const entry = createAgendaEntry({ availability: 'official', id: agendaEntryId('agenda_private-choice'), occursAt: '2026-09-04T08:00:00.000Z', releaseLabel: 'Épisode 20', workId: workId('work_private-choice') });
    const reminder = createReminder({ agendaEntryId: entry.id, channel: 'native', enabled: false, id: reminderId('reminder_private-choice'), leadMinutes: 30 });
    await storage.putReminder(reminder);
    expect(await scheduleAgendaPeriodNotifications(storage, tasks, [entry])).toBe(0);
    expect(await storage.getReminder(reminder.id)).toEqual(reminder);
  });

  it('routes cached public Agenda periods, preferences and alarm recovery through the background', () => {
    const background = readFileSync(new URL('./wxt-entrypoints/background.ts', import.meta.url), 'utf8');
    const surface = readFileSync(new URL('./runtime/ExtensionSurface.tsx', import.meta.url), 'utf8');
    expect(background).toMatch(/readLocalReleaseAgenda\(privateStorage\.storage, releaseAgenda, parsed\.data\)/);
    expect(background).toMatch(/new DexiePublicReleaseGenerationCache\(privateStorage\.storage\.database\)/);
    expect(background).toMatch(/new DexieLocalReleaseAgenda\(privateStorage\.storage\.database\)/);
    expect(background).toMatch(/projectLocalReleaseAgenda\(privateStorage\.storage, releaseCache, releaseAgenda\)/);
    expect(background).toMatch(/scheduleAgendaPeriodNotifications\(privateStorage\.storage, tasks/);
    expect(background).toMatch(/browser\.alarms\.onAlarm\.addListener/);
    expect(background).toMatch(/browser\.runtime\.onStartup\.addListener/);
    expect(background).toContain('Promise.all([resumeNotifications(), reconcileFavorites()])');
    expect(background).not.toContain('Promise.all([resumeNotifications(), reconcileFavorites(true), repairLibraryProjection()])');
    expect(background).toMatch(/preferences\.quick\.(read|write)/);
    expect(surface).toMatch(/useLocalAgenda\(\)/);
    expect(surface).toMatch(/agenda=\{agenda\}/);
    expect(surface).toMatch(/onRetryAgenda=\{localAgenda\.onRetry\}/);
    expect(background).toMatch(/sourceUrl: source\.url/);
    expect(surface).not.toMatch(/agenda=\{\{ state: 'blocked' \}\}/);
    expect(surface).not.toMatch(/days=\{\[\]\}/);
  });

  it('gates restart recovery with the persisted native preference', async () => {
    const storage = new MemoryStoragePort();
    const tasks = new MemoryTaskStore();
    const official = createAgendaEntry({ availability: 'official', id: agendaEntryId('agenda_restart-gate'), occursAt: '2026-09-04T08:00:00.000Z', releaseLabel: 'Épisode 20', workId: workId('work_restart-gate') });
    const reminder = createReminder({ agendaEntryId: official.id, channel: 'native', enabled: true, id: reminderId('reminder_restart-gate'), leadMinutes: 0 });
    await storage.transaction(['agenda', 'reminders'], async (session) => { await session.putAgendaEntry(official); await session.putReminder(reminder); });
    await scheduleAgendaNotification(tasks, official, reminder);
    const calls: string[] = [];
    const notifications = new WebExtensionNotificationAdapter({ create(id) { calls.push(id); } }, '/icons/notification.png');
    const disabled = { read: async () => ({ nativeNotifications: false, showEstimatedReleases: true, showAdultContent: false }), write: async () => undefined };
    expect(await drainDueAgendaNotifications({ notifications, preferences: disabled, storage, tasks }, new Date('2026-09-04T09:00:00.000Z'))).toBe(0);
    const enabled = { read: async () => ({ nativeNotifications: true, showEstimatedReleases: true, showAdultContent: false }), write: async () => undefined };
    expect(await drainDueAgendaNotifications({ notifications, preferences: enabled, storage, tasks }, new Date('2026-09-04T09:00:00.000Z'))).toBe(1);
    expect(calls).toEqual(['agenda-notification:reminder_restart-gate:2026-09-04T08:00:00.000Z']);
    expect(reminderAlarmName).toBe('tobirink-due-reminders');
  });

  it('never schedules a native notification from an estimate alone', async () => {
    const tasks = new MemoryTaskStore();
    const estimated = createAgendaEntry({
      availability: 'estimated',
      id: agendaEntryId('agenda_estimated'),
      occursAt: '2026-09-08T08:00:00.000Z',
      releaseLabel: 'Chapitre estimé',
      workId: workId('work_estimated'),
    });
    const reminder = createReminder({ agendaEntryId: estimated.id, channel: 'native', enabled: true, id: reminderId('reminder_estimated'), leadMinutes: 30 });
    expect(await scheduleAgendaNotification(tasks, estimated, reminder)).toEqual({ state: 'prediction-only' });
    expect(await tasks.claimNext('claim-none', '2026-09-09T08:00:00.000Z', '2026-09-09T08:01:00.000Z')).toBeUndefined();
  });

  it('creates deterministic reminders only for official or confirmed entries', async () => {
    const storage = new MemoryStoragePort();
    const tasks = new MemoryTaskStore();
    const official = createAgendaEntry({ availability: 'official', id: agendaEntryId('agenda_official-period'), occursAt: '2026-09-08T08:00:00.000Z', releaseLabel: 'Épisode officiel', workId: workId('work_official-period') });
    const estimated = createAgendaEntry({ availability: 'estimated', id: agendaEntryId('agenda_estimated-period'), occursAt: '2026-09-08T09:00:00.000Z', releaseLabel: 'Épisode estimé', workId: workId('work_estimated-period') });
    expect(await scheduleAgendaPeriodNotifications(storage, tasks, [official, estimated])).toBe(1);
    await expect(storage.getReminder(reminderId('reminder_official-period'))).resolves.toMatchObject({ agendaEntryId: official.id, leadMinutes: 0 });
    await expect(storage.getReminder(reminderId('reminder_estimated-period'))).resolves.toBeUndefined();
  });

  it('blocks an obsolete reminder and keeps the rescheduled release distinct', async () => {
    const storage = new MemoryStoragePort();
    const tasks = new MemoryTaskStore();
    const original = createAgendaEntry({ availability: 'confirmed', id: agendaEntryId('agenda_rescheduled'), occursAt: '2026-09-08T08:00:00.000Z', releaseLabel: 'Chapitre confirmé', workId: workId('work_rescheduled') });
    const reminder = createReminder({ agendaEntryId: original.id, channel: 'native', enabled: true, id: reminderId('reminder_rescheduled'), leadMinutes: 0 });
    await storage.transaction(['agenda', 'reminders'], async (session) => { await session.putAgendaEntry(original); await session.putReminder(reminder); });
    await scheduleAgendaNotification(tasks, original, reminder);
    const rescheduled = createAgendaEntry({ ...original, occursAt: '2026-09-09T08:00:00.000Z' });
    await storage.putAgendaEntry(rescheduled);
    const next = await scheduleAgendaNotification(tasks, rescheduled, reminder);

    expect(next).toMatchObject({ state: 'scheduled', task: { idempotencyKey: 'agenda-notification:reminder_rescheduled:2026-09-09T08:00:00.000Z' } });
    await expect(resumeDueAgendaNotification(
      { notifications: { publish: async () => { throw new Error('obsolete task must not publish'); } }, storage, tasks },
      { claimExpiresAt: '2026-09-08T09:01:00.000Z', claimToken: 'obsolete', now: '2026-09-08T09:00:00.000Z' },
    )).resolves.toBe('notifiable-entry-missing');
  });

  it('resumes a due official reminder after the worker is recreated', async () => {
    const storage = new MemoryStoragePort();
    const tasks = new MemoryTaskStore();
    const official = createAgendaEntry({
      availability: 'official',
      id: agendaEntryId('agenda_official'),
      occursAt: '2026-09-04T08:00:00.000Z',
      releaseLabel: 'Épisode 19',
      workId: workId('work_official'),
    });
    const reminder = createReminder({ agendaEntryId: official.id, channel: 'native', enabled: true, id: reminderId('reminder_official'), leadMinutes: 15 });
    await storage.transaction(['agenda', 'reminders'], async (session) => {
      await session.putAgendaEntry(official);
      await session.putReminder(reminder);
    });
    await scheduleAgendaNotification(tasks, official, reminder);
    expect(await tasks.claimNext('too-early', '2026-09-04T07:44:59.000Z', '2026-09-04T07:45:59.000Z')).toBeUndefined();

    const nativeCalls: string[] = [];
    const notifications = new WebExtensionNotificationAdapter({
      create(id, options) { nativeCalls.push(`${id}:${options.message}`); },
    }, '/icons/notification.png');
    const result = await resumeDueAgendaNotification(
      { notifications, storage, tasks },
      { claimExpiresAt: '2026-09-04T09:01:00.000Z', claimToken: 'worker-after-restart', now: '2026-09-04T09:00:00.000Z' },
    );

    expect(result).toBe('published');
    expect(nativeCalls).toHaveLength(1);
    expect(nativeCalls[0]).toContain('Épisode 19');
  });
});
