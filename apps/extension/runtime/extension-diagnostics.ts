import { z } from 'zod';

export const extensionDiagnosticsLockKey = 'tobirink.extensionDiagnostics' as const;
export const extensionDiagnosticsLockValue = 'extension-v1' as const;
export const extensionDiagnosticsEventsKey = 'tobirink.extensionDiagnostics.events.v1' as const;
const maximumEvents = 100;
const maximumCount = 100_000;

const identifierSchema = z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/u);
const diagnosticCountsSchema = z.strictObject({
  batches: z.number().int().min(0).max(maximumCount).optional(),
  blocked: z.number().int().min(0).max(maximumCount).optional(),
  completed: z.number().int().min(0).max(maximumCount).optional(),
  observed: z.number().int().min(0).max(maximumCount).optional(),
  retried: z.number().int().min(0).max(maximumCount).optional(),
  admissionWaiting: z.number().int().min(0).max(maximumCount).optional(),
  rateLimited: z.number().int().min(0).max(maximumCount).optional(),
  networkErrors: z.number().int().min(0).max(maximumCount).optional(),
  actionRequired: z.number().int().min(0).max(maximumCount).optional(),
  providerPaused: z.number().int().min(0).max(maximumCount).optional(),
});
export const extensionDiagnosticEventSchema = z.strictObject({
  counts: diagnosticCountsSchema.optional(),
  errorCode: z.enum(['INVENTORY_UNAVAILABLE', 'RESOLUTION_UNAVAILABLE']).optional(),
  nextAttemptAt: z.string().datetime({ offset: true }).optional(),
  occurredAt: z.string().datetime({ offset: true }),
  outcome: z.enum(['started', 'complete', 'retryable', 'failed']),
  runId: identifierSchema,
  sequence: identifierSchema,
  stage: z.enum(['run', 'inventory', 'resolution']),
  version: z.literal(1),
});

export type ExtensionDiagnosticEvent = z.infer<typeof extensionDiagnosticEventSchema>;
export type ExtensionDiagnosticInput = Omit<ExtensionDiagnosticEvent, 'occurredAt' | 'sequence' | 'version'>;
export interface ExtensionDiagnosticsSnapshot { readonly enabled: boolean; readonly events: readonly ExtensionDiagnosticEvent[] }
export interface ExtensionDiagnosticsPort { record(event: ExtensionDiagnosticInput): Promise<void> }

interface LocalStorageArea {
  get(key: typeof extensionDiagnosticsLockKey): Promise<DiagnosticStorageState>;
  get(keys: readonly [typeof extensionDiagnosticsLockKey, typeof extensionDiagnosticsEventsKey]): Promise<DiagnosticStorageState>;
  set(items: DiagnosticStorageWrite): Promise<void>;
}

interface DiagnosticStorageState {
  readonly 'tobirink.extensionDiagnostics'?: unknown;
  readonly 'tobirink.extensionDiagnostics.events.v1'?: unknown;
}

interface DiagnosticStorageWrite {
  readonly 'tobirink.extensionDiagnostics'?: string;
  readonly 'tobirink.extensionDiagnostics.events.v1'?: readonly ExtensionDiagnosticEvent[];
}

export class WebExtensionDiagnostics implements ExtensionDiagnosticsPort {
  private pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly storage: LocalStorageArea,
    private readonly now: () => string,
    private readonly token: () => string,
  ) {}

  async initializeEnabled(): Promise<void> {
    const current = await this.storage.get(extensionDiagnosticsLockKey);
    if (current[extensionDiagnosticsLockKey] === undefined) {
      await this.storage.set({ [extensionDiagnosticsLockKey]: extensionDiagnosticsLockValue });
    }
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.storage.set({ [extensionDiagnosticsLockKey]: enabled ? extensionDiagnosticsLockValue : 'off' });
  }

  async read(): Promise<ExtensionDiagnosticsSnapshot> {
    const stored = await this.storage.get([extensionDiagnosticsLockKey, extensionDiagnosticsEventsKey]);
    const parsedEvents = z.array(extensionDiagnosticEventSchema).max(maximumEvents).safeParse(stored[extensionDiagnosticsEventsKey]);
    return {
      enabled: stored[extensionDiagnosticsLockKey] === extensionDiagnosticsLockValue,
      events: parsedEvents.success ? parsedEvents.data : [],
    };
  }

  async record(input: ExtensionDiagnosticInput): Promise<void> {
    const operation = this.pending.then(async () => {
      const stored = await this.storage.get([extensionDiagnosticsLockKey, extensionDiagnosticsEventsKey]);
      if (stored[extensionDiagnosticsLockKey] !== extensionDiagnosticsLockValue) return;
      const event = extensionDiagnosticEventSchema.parse({ ...input, occurredAt: this.now(), sequence: this.token(), version: 1 });
      const parsedEvents = z.array(extensionDiagnosticEventSchema).max(maximumEvents).safeParse(stored[extensionDiagnosticsEventsKey]);
      const events = [...(parsedEvents.success ? parsedEvents.data : []), event].slice(-maximumEvents);
      await this.storage.set({ [extensionDiagnosticsEventsKey]: events });
    });
    this.pending = operation.catch(() => undefined);
    await operation;
  }
}
