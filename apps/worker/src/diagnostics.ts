import { z } from 'zod';

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

const workerCostResultSchema = z.enum(['backoff', 'changed', 'deduplicated', 'failed', 'unchanged']);
const workerCostTaskSchema = z.enum(['agenda', 'agenda-admission', 'agenda-recovery', 'discovery', 'discovery-admission', 'discovery-lookup', 'discovery-refresh']);
const workerCostProviderSchema = z.enum(['anilist', 'kitsu', 'mangadex', 'mangaupdates', 'mixed', 'none']);
export type WorkerCostResult = z.output<typeof workerCostResultSchema>;
export type WorkerCostTask = z.output<typeof workerCostTaskSchema>;
export type WorkerCostProvider = z.output<typeof workerCostProviderSchema>;
const countSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const durationSchema = countSchema.max(3_600_000);
// Strip undeclared fields rather than serializing arbitrary properties from a caller.
const workerCostDiagnosticEventSchema = z.object({
  schemaVersion: z.literal(1), type: z.literal('worker.cost'),
  task: workerCostTaskSchema, provider: workerCostProviderSchema,
  pagesRequested: countSchema, providerRequests: countSchema, acceptedResults: countSchema,
  result: workerCostResultSchema, durationMs: durationSchema, retries: countSchema,
  providerTransportDurationMs: durationSchema.optional(),
  provider429s: countSchema.optional(), providerHttpErrors: countSchema.optional(), providerNetworkErrors: countSchema.optional(),
  d1RowsRead: countSchema.optional(), d1RowsWritten: countSchema.optional(),
  d1Hits: countSchema.optional(), d1Misses: countSchema.optional(), deduplicated: countSchema.optional(),
  generationsCreated: countSchema.optional(), generationsAvoided: countSchema.optional(), rehydrations: countSchema.optional(),
  r2Reads: countSchema.optional(), r2Writes: countSchema.optional(), r2Lists: countSchema.optional(), r2Conflicts: countSchema.optional(),
  queueSends: countSchema.optional(), queueFailures: countSchema.optional(),
});
export type WorkerCostDiagnosticEvent = Readonly<z.output<typeof workerCostDiagnosticEventSchema>>;

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
  const parsed = workerCostDiagnosticEventSchema.safeParse(event);
  if (parsed.success) console.info(JSON.stringify(parsed.data));
}

export function workerMethod(value: string): WorkerDiagnosticEvent['method'] {
  if (value === 'GET' || value === 'POST') return value;
  return 'OTHER';
}

export function boundedDuration(startedAt: number, endedAt: number): number {
  return Math.min(3_600_000, Math.max(0, Math.round(endedAt - startedAt)));
}
