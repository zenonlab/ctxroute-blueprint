import { describe, expect, it } from 'vitest';
import { createReleaseOccurrence } from './release-events';

describe('release occurrences', () => {
  it('keeps civil dates timezone free', () => {
    expect(createReleaseOccurrence({ kind: 'DATE', value: '2026-09-13' })).toEqual({ kind: 'DATE', value: '2026-09-13' });
  });
  it('requires canonical UTC instants', () => {
    expect(() => createReleaseOccurrence({ kind: 'INSTANT', value: '2026-09-13T12:00:00.000+01:00' })).toThrow();
    expect(createReleaseOccurrence({ kind: 'INSTANT', value: '2026-09-13T11:00:00.000Z' })).toEqual({ kind: 'INSTANT', value: '2026-09-13T11:00:00.000Z' });
  });
});
