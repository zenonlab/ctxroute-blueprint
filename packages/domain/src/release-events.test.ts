import { describe, expect, it } from 'vitest';
import { createPublicReleaseEvent, createReleaseOccurrence } from './release-events';

describe('release occurrences', () => {
  it('keeps civil dates timezone free', () => {
    expect(createReleaseOccurrence({ kind: 'DATE', value: '2026-09-13' })).toEqual({ kind: 'DATE', value: '2026-09-13' });
    expect(() => createReleaseOccurrence({ kind: 'DATE', value: '2026-02-30' })).toThrow();
  });
  it('requires canonical UTC instants', () => {
    expect(() => createReleaseOccurrence({ kind: 'INSTANT', value: '2026-09-13T12:00:00.000+01:00' })).toThrow();
    expect(createReleaseOccurrence({ kind: 'INSTANT', value: '2026-09-13T11:00:00.000Z' })).toEqual({ kind: 'INSTANT', value: '2026-09-13T11:00:00.000Z' });
  });
  it('preserves bounded textual release numbers', () => {
    const event = createPublicReleaseEvent({
      expiresAt: '2026-11-12T00:00:00.000Z',
      id: 'mangaupdates-chapter-1-29-29.5-end',
      occurrence: { kind: 'DATE', value: '2026-09-13' },
      provenance: { fetchedAt: '2026-09-13T00:00:00.000Z', parserVersion: '2', rulesVersion: '2', source: 'mangaupdates' },
      provider: 'mangaupdates',
      providerWorkId: '1',
      releaseKind: 'chapter',
      sequence: '29-29.5 (end)',
      state: 'CONFIRMED',
    });
    expect(event.sequence).toBe('29-29.5 (end)');
  });
});
