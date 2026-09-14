export const workerDiagnosticsLockValue = 'worker-v1' as const;

export type WorkerRouteFamily = 'catalogue' | 'cover' | 'release' | 'site' | 'unknown';

export interface WorkerDiagnosticEvent {
  readonly schemaVersion: 1;
  readonly type: 'worker.request' | 'worker.error';
  readonly requestId: string;
  readonly routeFamily: WorkerRouteFamily;
  readonly method: 'GET' | 'POST' | 'OTHER';
  readonly status: number;
  readonly durationMs: number;
}

interface WorkerDiagnosticBindings {
  readonly TOBIRINK_WORKER_DIAGNOSTICS?: string;
}

export function classifyWorkerRoute(pathname: string): WorkerRouteFamily {
  if (pathname === '/v1/catalogue' || pathname.startsWith('/v1/catalogue/') || pathname.startsWith('/v2/catalogue/')) return 'catalogue';
  if (pathname.startsWith('/v1/media/provider-covers/') || pathname.startsWith('/v1/media/covers/')) return 'cover';
  if (pathname === '/v1/releases' || pathname === '/v2/releases' || pathname.startsWith('/v2/releases/') || pathname.startsWith('/downloads/')) return 'release';
  if (pathname === '/' || pathname === '/library' || pathname.startsWith('/library/') || pathname === '/agenda' || pathname === '/privacy' || pathname === '/download') return 'site';
  return 'unknown';
}

export function emitWorkerDiagnostic(bindings: WorkerDiagnosticBindings, event: WorkerDiagnosticEvent): void {
  if (bindings.TOBIRINK_WORKER_DIAGNOSTICS !== workerDiagnosticsLockValue) return;
  console.info(JSON.stringify(event));
}

export function workerMethod(value: string): WorkerDiagnosticEvent['method'] {
  if (value === 'GET' || value === 'POST') return value;
  return 'OTHER';
}

export function boundedDuration(startedAt: number, endedAt: number): number {
  return Math.min(3_600_000, Math.max(0, Math.round(endedAt - startedAt)));
}
