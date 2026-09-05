import { describe, expect, it } from 'vitest';
import { claimTask, commitTask, createDurableTask, isTaskAvailable, recordTaskEffect, retryTask } from './task-state';
describe('durable tasks', () => {
  it('records effects before commit', () => {
    const ready = createDurableTask({ id: 'task-1', idempotencyKey: 'key-1', kind: 'fixture', payload: '{}' });
    const claimed = claimTask(ready, 'token', '2026-09-04T10:00:00.000Z', '2026-09-04T10:01:00.000Z');
    expect(() => commitTask(claimed, 'token')).toThrow('EFFECT_RECORDED');
    expect(commitTask(recordTaskEffect(claimed, 'token', 'effect'), 'token').state).toBe('COMMITTED');
  });
  it('recovers expired claims and delayed retries by time input', () => {
    const ready = createDurableTask({ id: 'task-2', idempotencyKey: 'key-2', kind: 'fixture', payload: '{}' });
    const claimed = claimTask(ready, 'token', '2026-09-04T10:00:00.000Z', '2026-09-04T10:01:00.000Z');
    expect(isTaskAvailable(claimed, '2026-09-04T10:02:00.000Z')).toBe(true);
    expect(isTaskAvailable(retryTask(claimed, 'token', '2026-09-04T10:03:00.000Z'), '2026-09-04T10:02:00.000Z')).toBe(false);
  });
});
