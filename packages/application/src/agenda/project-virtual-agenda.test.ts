import { describe, expect, it } from 'vitest';
import { projectVirtualAgenda } from './project-virtual-agenda';
import type { VirtualReleaseModelContract } from '../releases/release-contracts';

const base: VirtualReleaseModelContract = {
  workId: 'work_1', provider: 'mangaupdates', providerWorkId: '42', releaseKind: 'chapter',
  anchor: { date: '2026-09-01', sequence: '58.5' }, intervalDays: 7, exceptions: [],
  validity: { from: '2026-09-01', to: '2026-10-01' }, editorialStatus: 'ONGOING',
  provenance: { source: 'mangaupdates', observedAt: '2026-09-02T00:00:00.000Z', parserVersion: '1', rulesVersion: '1' }, revision: 'model-1',
};

describe('projectVirtualAgenda', () => {
  it('invalidates future announcements from a verified cancelled status while preserving confirmed history', () => {
    const announced = { id: 'future', provider: 'mangaupdates' as const, providerWorkId: '42', releaseKind: 'chapter' as const, sequence: '59', occurrence: { kind: 'DATE' as const, value: '2026-09-12' }, state: 'SCHEDULED' as const, provenance: { source: 'mangaupdates', fetchedAt: '2026-09-02T00:00:00.000Z', parserVersion: '1', rulesVersion: '1' }, expiresAt: '2026-10-01T00:00:00.000Z' };
    const confirmed = { ...announced, id: 'confirmed', sequence: '58', state: 'CONFIRMED' as const, occurrence: { kind: 'DATE' as const, value: '2026-09-01' } };
    const past = { ...announced, id: 'past', sequence: '57', occurrence: { kind: 'DATE' as const, value: '2026-08-25' } };
    const model = { ...base, editorialStatus: 'CANCELLED' as const, exceptions: [confirmed, past], explicitNext: announced, provenance: { ...base.provenance, observedAt: '2026-09-10T00:00:00.000Z' } };
    expect(projectVirtualAgenda([model], { from: '2026-08-01', to: '2026-10-01' })).toMatchObject([{ id: 'past', state: 'SCHEDULED' }, { id: 'confirmed', state: 'CONFIRMED' }, { id: 'future', state: 'CANCELLED', provenance: { fetchedAt: '2026-09-10T00:00:00.000Z' } }]);
  });

  it('projects only one estimate and preserves a fractional anchor without inventing a total', () => {
    expect(projectVirtualAgenda([base], { from: '2026-09-01', to: '2026-10-01' })).toMatchObject([
      { occurrence: { kind: 'DATE', value: '2026-09-08' }, state: 'ESTIMATED' },
    ]);
  });

  it('prefers an explicit announcement and suspends cadence during hiatus', () => {
    const explicit = { id: 'explicit-1', provider: 'mangaupdates' as const, providerWorkId: '42', releaseKind: 'chapter' as const, sequence: '59', occurrence: { kind: 'DATE' as const, value: '2026-09-12' }, state: 'SCHEDULED' as const, provenance: { source: 'mangaupdates', fetchedAt: '2026-09-02T00:00:00.000Z', parserVersion: '1', rulesVersion: '1' }, expiresAt: '2026-10-01T00:00:00.000Z' };
    expect(projectVirtualAgenda([{ ...base, explicitNext: explicit }], { from: '2026-09-01', to: '2026-10-01' })).toEqual([explicit]);
    expect(projectVirtualAgenda([{ ...base, editorialStatus: 'HIATUS' }], { from: '2026-09-01', to: '2026-10-01' })).toEqual([]);
  });

  it('replaces a postponed occurrence and retains an explicit cancellation instead of estimating it', () => {
    const announced = { id: 'old', provider: 'mangaupdates' as const, providerWorkId: '42', releaseKind: 'chapter' as const, sequence: '59', occurrence: { kind: 'DATE' as const, value: '2026-09-12' }, state: 'SCHEDULED' as const, provenance: { source: 'mangaupdates', fetchedAt: '2026-09-02T00:00:00.000Z', parserVersion: '1', rulesVersion: '1' }, expiresAt: '2026-10-01T00:00:00.000Z' };
    const postponed = { ...announced, id: 'new', occurrence: { kind: 'DATE' as const, value: '2026-09-19' }, provenance: { ...announced.provenance, fetchedAt: '2026-09-09T00:00:00.000Z' } };
    expect(projectVirtualAgenda([{ ...base, exceptions: [announced, postponed], explicitNext: announced }], base.validity)).toEqual([postponed]);
    const cancelled = { ...postponed, state: 'CANCELLED' as const, provenance: { ...postponed.provenance, fetchedAt: '2026-09-10T00:00:00.000Z' } };
    expect(projectVirtualAgenda([{ ...base, exceptions: [announced, cancelled], explicitNext: postponed }], base.validity)).toEqual([cancelled]);
  });
});
