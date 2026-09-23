import { describe, expect, it, vi } from 'vitest';
import { boundedDuration, classifyWorkerRoute, emitWorkerCostDiagnostic, emitWorkerDiagnostic, workerDiagnosticsLockValue, workerMethod } from './diagnostics';

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

  it('honors the explicit boolean override', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const event = { durationMs: 1, method: 'GET' as const, requestId: 'request-boolean', routeFamily: 'catalogue' as const, schemaVersion: 1 as const, status: 200, type: 'worker.request' as const };
    emitWorkerDiagnostic({ TOBIRINK_WORKER_DIAGNOSTICS: workerDiagnosticsLockValue, TOBIRINK_PIPELINE_DEBUG: false }, event);
    emitWorkerDiagnostic({ TOBIRINK_WORKER_DIAGNOSTICS: 'off', TOBIRINK_PIPELINE_DEBUG: true }, event);
    expect(info).toHaveBeenCalledOnce();
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

  it('emits a closed cost event without user or provider content', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    emitWorkerCostDiagnostic({ TOBIRINK_WORKER_DIAGNOSTICS: workerDiagnosticsLockValue }, {
      acceptedResults: 20, d1RowsRead: 24, d1RowsWritten: 20, durationMs: 120,
      pagesRequested: 3, provider: 'mixed', providerRequests: 3, result: 'changed', retries: 0,
      schemaVersion: 1, task: 'discovery', type: 'worker.cost',
    });
    const serialized = String(info.mock.calls[0]?.[0]);
    expect(Object.keys(JSON.parse(serialized)).sort()).toEqual([
      'acceptedResults', 'd1RowsRead', 'd1RowsWritten', 'durationMs', 'pagesRequested',
      'provider', 'providerRequests', 'result', 'retries', 'schemaVersion', 'task', 'type',
    ].sort());
    expect(serialized).not.toMatch(/title|url|ip|payload|secret|installation/iu);
    info.mockRestore();
  });

  it('strips undeclared content and drops invalid bounded cost values', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const event = {
      acceptedResults: 0, durationMs: 40, pagesRequested: 1, provider: 'anilist' as const,
      providerRequests: 2, providerTransportDurationMs: 30, provider429s: 1,
      providerHttpErrors: 1, providerNetworkErrors: 1, result: 'backoff' as const, retries: 0,
      schemaVersion: 1 as const, task: 'discovery' as const, type: 'worker.cost' as const,
      url: 'https://private.invalid', title: 'private title', error: new Error('private failure'),
    };
    emitWorkerCostDiagnostic({ TOBIRINK_WORKER_DIAGNOSTICS: workerDiagnosticsLockValue }, event);
    const emitted = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(emitted).toMatchObject({ providerTransportDurationMs: 30, provider429s: 1, providerHttpErrors: 1, providerNetworkErrors: 1 });
    expect(JSON.stringify(emitted)).not.toMatch(/private|title|url|failure/iu);
    for (const value of [-1, 0.5, Infinity, NaN]) {
      emitWorkerCostDiagnostic({ TOBIRINK_WORKER_DIAGNOSTICS: workerDiagnosticsLockValue }, { ...event, provider429s: value });
    }
    emitWorkerCostDiagnostic({ TOBIRINK_WORKER_DIAGNOSTICS: workerDiagnosticsLockValue }, { ...event, providerTransportDurationMs: 3_600_001 });
    expect(info).toHaveBeenCalledOnce();
    info.mockRestore();
  });
});
