import { describe, expect, it } from 'vitest';
import { resolutionStatusResponseSchema } from './resolution-status-messages';

describe('resolution status diagnostics', () => {
  it('accepts only bounded technical diagnostic events', () => {
    const response = {
      controller: { paused: false, state: 'resolving' },
      counts: { blocked: 0, observed: 2, processing: 1, resolved: 0, retryable: 0, review: 0, unsupported: 1 },
      diagnostics: { enabled: true, events: [{ occurredAt: '2026-09-12T12:00:00.000Z', outcome: 'complete', runId: 'run-1', sequence: 'event-1', stage: 'run', version: 1 }] },
      inventory: { status: 'complete' },
      ok: true,
    };
    expect(resolutionStatusResponseSchema.safeParse(response).success).toBe(true);
    const privateEvent = { ...response.diagnostics.events[0], title: 'private' };
    expect(resolutionStatusResponseSchema.safeParse({ ...response, diagnostics: { enabled: true, events: [privateEvent] } }).success).toBe(false);
  });
});
