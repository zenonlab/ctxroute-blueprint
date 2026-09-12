import { z } from 'zod';
import { extensionDiagnosticEventSchema } from './extension-diagnostics';

export const resolutionStatusMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('favorite.status.read'), version: z.literal(1) }),
  z.strictObject({ type: z.literal('favorite.reconcile'), version: z.literal(1) }),
  z.strictObject({ action: z.enum(['pause', 'resume', 'retry-blocked']), type: z.literal('favorite.control.write'), version: z.literal(1) }),
  z.strictObject({ enabled: z.boolean(), type: z.literal('favorite.diagnostics.write'), version: z.literal(1) }),
]);
const countsSchema = z.strictObject({ observed: z.number().int().nonnegative(), processing: z.number().int().nonnegative(), resolved: z.number().int().nonnegative(), review: z.number().int().nonnegative(), retryable: z.number().int().nonnegative(), blocked: z.number().int().nonnegative(), unsupported: z.number().int().nonnegative(), internalErrors: z.number().int().nonnegative().optional(), collectivePending: z.number().int().nonnegative().optional() });
const controllerSchema = z.strictObject({ paused: z.boolean(), state: z.enum(['idle', 'inventory', 'presence', 'resolving', 'waiting-provider', 'blocked', 'paused', 'complete']) });
export const resolutionStatusResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), controller: controllerSchema, counts: countsSchema, diagnostics: z.strictObject({ enabled: z.boolean(), events: z.array(extensionDiagnosticEventSchema).max(100) }), inventory: z.strictObject({ continuationAt: z.iso.datetime().optional(), startedAt: z.iso.datetime().optional(), status: z.enum(['not-started', 'inventory', 'presence', 'complete']) }) }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);

export async function readResolutionStatus(reconcile = false) {
  const response = resolutionStatusResponseSchema.parse(await browser.runtime.sendMessage({ type: reconcile ? 'favorite.reconcile' : 'favorite.status.read', version: 1 }));
  if (!response.ok) throw new Error('Favorite status unavailable.');
  return { controller: response.controller, counts: response.counts, diagnostics: response.diagnostics, inventory: response.inventory };
}

export async function writeDiagnosticsEnabled(enabled: boolean) {
  const response = resolutionStatusResponseSchema.parse(await browser.runtime.sendMessage({ enabled, type: 'favorite.diagnostics.write', version: 1 }));
  if (!response.ok) throw new Error('Favorite diagnostics unavailable.');
  return { controller: response.controller, counts: response.counts, diagnostics: response.diagnostics, inventory: response.inventory };
}

export async function writeResolutionControl(action: 'pause' | 'resume' | 'retry-blocked') {
  const response = resolutionStatusResponseSchema.parse(await browser.runtime.sendMessage({ action, type: 'favorite.control.write', version: 1 }));
  if (!response.ok) throw new Error('Favorite controller unavailable.');
  return { controller: response.controller, counts: response.counts, diagnostics: response.diagnostics, inventory: response.inventory };
}
