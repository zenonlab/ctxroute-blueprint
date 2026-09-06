import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  blockTask,
  claimTask,
  commitTask,
  createDurableTask,
  isTaskAvailable,
  recordTaskEffect,
  resumeDueAgendaNotification,
  retryTask,
  scheduleAgendaNotification,
} from '../../packages/application/src';
import type { DurableTask, TaskStorePort } from '../../packages/application/src';
import { WebExtensionNotificationAdapter } from '../../packages/adapters-browser/src';
import { MemoryStoragePort } from '../../packages/contracts/src/memory-storage-port';
import { agendaEntryId, createAgendaEntry, createReminder, reminderId, workId } from '../../packages/domain/src';

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
  it('routes local Agenda periods through the background without a remote read', () => {
    const background = readFileSync(new URL('./wxt-entrypoints/background.ts', import.meta.url), 'utf8');
    const surface = readFileSync(new URL('./runtime/ExtensionSurface.tsx', import.meta.url), 'utf8');
    expect(background).toMatch(/readAgendaPeriod\(privateStorage\.storage, parsed\.data\)/);
    expect(surface).toMatch(/useLocalAgenda\(\)/);
    expect(surface).not.toMatch(/days=\{\[\]\}/);
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
