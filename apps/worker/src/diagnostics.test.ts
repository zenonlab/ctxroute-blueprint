import { describe, expect, it, vi } from 'vitest';
import { boundedDuration, classifyWorkerRoute, emitWorkerDiagnostic, workerDiagnosticsLockValue, workerMethod } from './diagnostics';

describe('worker diagnostics', () => {
  it('emits only for the exact lock value and never serializes request content', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const event = { durationMs: 12, method: 'POST' as const, requestId: 'request-1', routeFamily: 'catalogue' as const, schemaVersion: 1 as const, status: 202, type: 'worker.request' as const };
    emitWorkerDiagnostic({ TOBIRINK_WORKER_DIAGNOSTICS: 'off' }, event);
    emitWorkerDiagnostic({ TOBIRINK_WORKER_DIAGNOSTICS: workerDiagnosticsLockValue }, event);
    expect(info).toHaveBeenCalledOnce();
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual(event);
    expect(String(info.mock.calls[0]?.[0])).not.toMatch(/title|url|folder|progress|secret/iu);
    info.mockRestore();
  });

  it('reduces paths methods and durations to bounded technical values', () => {
    expect(classifyWorkerRoute('/v2/favorites/lookup')).toBe('unknown');
    expect(classifyWorkerRoute('/v3/catalogue/discoveries/collector/claims')).toBe('catalogue');
    expect(classifyWorkerRoute('/v2/releases/generations')).toBe('release');
    expect(classifyWorkerRoute('/v3/releases')).toBe('release');
    expect(classifyWorkerRoute('/library/work_123')).toBe('site');
    expect(classifyWorkerRoute('/private/value')).toBe('unknown');
    expect(workerMethod('DELETE')).toBe('OTHER');
    expect(boundedDuration(20, 10)).toBe(0);
    expect(boundedDuration(0, Number.MAX_SAFE_INTEGER)).toBe(3_600_000);
  });
});
