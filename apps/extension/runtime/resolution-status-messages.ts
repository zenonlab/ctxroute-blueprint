import { z } from 'zod';
import { extensionDiagnosticEventSchema } from './extension-diagnostics';

export const resolutionStatusMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('favorite.status.read'), version: z.literal(1) }),
  z.strictObject({ type: z.literal('favorite.reconcile'), version: z.literal(1) }),
  z.strictObject({ enabled: z.boolean(), type: z.literal('favorite.diagnostics.write'), version: z.literal(1) }),
]);
const countsSchema = z.strictObject({ observed: z.number().int().nonnegative(), processing: z.number().int().nonnegative(), retryable: z.number().int().nonnegative(), unsupported: z.number().int().nonnegative(), internalErrors: z.number().int().nonnegative().optional(), collectivePending: z.number().int().nonnegative().optional() });
export const resolutionStatusResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), counts: countsSchema, diagnostics: z.strictObject({ enabled: z.boolean(), events: z.array(extensionDiagnosticEventSchema).max(100) }), inventory: z.strictObject({ startedAt: z.string().optional(), status: z.enum(['not-started', 'active', 'complete']) }) }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);

export async function readResolutionStatus(reconcile = false) {
  const response = resolutionStatusResponseSchema.parse(await browser.runtime.sendMessage({ type: reconcile ? 'favorite.reconcile' : 'favorite.status.read', version: 1 }));
  if (!response.ok) throw new Error('Favorite status unavailable.');
  return { counts: response.counts, diagnostics: response.diagnostics, inventory: response.inventory };
}

export async function writeDiagnosticsEnabled(enabled: boolean) {
  const response = resolutionStatusResponseSchema.parse(await browser.runtime.sendMessage({ enabled, type: 'favorite.diagnostics.write', version: 1 }));
  if (!response.ok) throw new Error('Favorite diagnostics unavailable.');
  return { counts: response.counts, diagnostics: response.diagnostics, inventory: response.inventory };
}
