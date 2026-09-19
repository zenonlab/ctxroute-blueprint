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

export interface WorkerDiagnosticBindings {
  readonly TOBIRINK_WORKER_DIAGNOSTICS?: string;
  readonly TOBIRINK_PIPELINE_DEBUG?: boolean;
}

export type WorkerCostResult = 'backoff' | 'changed' | 'deduplicated' | 'failed' | 'unchanged';
export type WorkerCostTask = 'agenda' | 'agenda-admission' | 'agenda-recovery' | 'discovery' | 'discovery-admission' | 'discovery-lookup' | 'discovery-refresh';
export type WorkerCostProvider = 'anilist' | 'kitsu' | 'mangadex' | 'mangaupdates' | 'mixed' | 'none';

export interface WorkerCostDiagnosticEvent {
  readonly schemaVersion: 1;
  readonly type: 'worker.cost';
  readonly task: WorkerCostTask;
  readonly provider: WorkerCostProvider;
  readonly pagesRequested: number;
  readonly providerRequests: number;
  readonly acceptedResults: number;
  readonly result: WorkerCostResult;
  readonly durationMs: number;
  readonly retries: number;
  readonly d1RowsRead?: number;
  readonly d1RowsWritten?: number;
  readonly d1Hits?: number;
  readonly d1Misses?: number;
  readonly deduplicated?: number;
  readonly generationsCreated?: number;
  readonly generationsAvoided?: number;
  readonly rehydrations?: number;
  readonly r2Reads?: number;
  readonly r2Writes?: number;
  readonly r2Lists?: number;
  readonly r2Conflicts?: number;
  readonly queueSends?: number;
  readonly queueFailures?: number;
}

export function classifyWorkerRoute(pathname: string): WorkerRouteFamily {
  if (pathname === '/v1/catalogue' || pathname.startsWith('/v1/catalogue/') || pathname.startsWith('/v2/catalogue/') || pathname.startsWith('/v3/catalogue/')) return 'catalogue';
  if (pathname.startsWith('/v1/media/provider-covers/') || pathname.startsWith('/v1/media/covers/')) return 'cover';
  if (pathname === '/v1/releases' || pathname === '/v2/releases' || pathname === '/v3/releases' || pathname.startsWith('/v2/releases/') || pathname.startsWith('/downloads/')) return 'release';
  if (pathname === '/' || pathname === '/library' || pathname.startsWith('/library/') || pathname === '/agenda' || pathname === '/privacy' || pathname === '/download') return 'site';
  return 'unknown';
}

export function emitWorkerDiagnostic(bindings: WorkerDiagnosticBindings, event: WorkerDiagnosticEvent): void {
  if (bindings.TOBIRINK_PIPELINE_DEBUG !== undefined ? !bindings.TOBIRINK_PIPELINE_DEBUG : bindings.TOBIRINK_WORKER_DIAGNOSTICS !== workerDiagnosticsLockValue) return;
  console.info(JSON.stringify(event));
}

export function emitWorkerCostDiagnostic(bindings: WorkerDiagnosticBindings | undefined, event: WorkerCostDiagnosticEvent): void {
  if (bindings === undefined || (bindings.TOBIRINK_PIPELINE_DEBUG !== undefined ? !bindings.TOBIRINK_PIPELINE_DEBUG : bindings.TOBIRINK_WORKER_DIAGNOSTICS !== workerDiagnosticsLockValue)) return;
  console.info(JSON.stringify(event));
}

export function workerMethod(value: string): WorkerDiagnosticEvent['method'] {
  if (value === 'GET' || value === 'POST') return value;
  return 'OTHER';
}

export function boundedDuration(startedAt: number, endedAt: number): number {
  return Math.min(3_600_000, Math.max(0, Math.round(endedAt - startedAt)));
}
