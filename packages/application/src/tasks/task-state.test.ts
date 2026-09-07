import { describe, expect, it } from 'vitest';
import { favoriteSourceId, reviewId } from '@tobirink/domain';
import { encodeFavoriteResolutionTaskPayload, parseFavoriteResolutionTaskPayload } from './favorite-resolution-task-payload';
import { claimTask, commitTask, createDurableTask, createScheduledDurableTask, isTaskAvailable, recordTaskEffect, restoreDurableTask, retryTask } from './task-state';
describe('durable tasks', () => {
  it('records effects before commit', () => {
    const ready = createDurableTask({ id: 'task-1', idempotencyKey: 'key-1', kind: 'fixture', payload: '{}' });
    expect(ready.availableAt).toBe('1970-01-01T00:00:00.000Z');
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
  it('keeps scheduled work unavailable until its exact instant', () => {
    const scheduled = createScheduledDurableTask({ id: 'task-3', idempotencyKey: 'key-3', kind: 'fixture', payload: '{}' }, '2026-09-04T10:03:00.000Z');
    expect(isTaskAvailable(scheduled, '2026-09-04T10:02:59.999Z')).toBe(false);
    expect(isTaskAvailable(scheduled, '2026-09-04T10:03:00.000Z')).toBe(true);
  });
  it('rejects an oversized persisted payload', () => {
    expect(() => createDurableTask({ id: 'task-large', idempotencyKey: 'key-large', kind: 'fixture', payload: 'é'.repeat(32 * 1024 + 1) })).toThrow(/65536 UTF-8 bytes/u);
  });
  it('round-trips only a strict favorite resolution payload', () => {
    const payload = { reviewId: reviewId('review_task00'), semanticFingerprint: 'fnv1a32:12345678', sourceId: favoriteSourceId('source_task00') };
    expect(parseFavoriteResolutionTaskPayload(encodeFavoriteResolutionTaskPayload(payload))).toEqual(payload);
    expect(() => parseFavoriteResolutionTaskPayload('{"sourceId":"source_task"}')).toThrow();
  });
  it('restores the pre-availableAt notification record shape', () => {
    const legacy = { ...createDurableTask({ id: 'legacy-task', idempotencyKey: 'legacy-key', kind: 'fixture', payload: '{}' }) };
    Reflect.deleteProperty(legacy, 'availableAt');
    expect(restoreDurableTask(legacy).availableAt).toBe('1970-01-01T00:00:00.000Z');
  });
});
