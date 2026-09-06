import { quickPreferencesSchema } from '@tobirink/application';
import { z } from 'zod';

const version = 1 as const;
export const quickPreferencesReadMessageSchema = z.strictObject({ type: z.literal('preferences.quick.read'), version: z.literal(version) });
export const quickPreferencesWriteMessageSchema = z.strictObject({ preferences: quickPreferencesSchema, type: z.literal('preferences.quick.write'), version: z.literal(version) });
export const quickPreferencesResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), preferences: quickPreferencesSchema }),
  z.strictObject({ error: z.string(), ok: z.literal(false) }),
]);
export type QuickPreferencesResponse = z.infer<typeof quickPreferencesResponseSchema>;

export async function readQuickPreferencesMessage() {
  const response = quickPreferencesResponseSchema.parse(await browser.runtime.sendMessage({ type: 'preferences.quick.read', version }));
  if (!response.ok) throw new Error(response.error);
  return response.preferences;
}

export async function writeQuickPreferencesMessage(preferences: z.infer<typeof quickPreferencesSchema>) {
  const response = quickPreferencesResponseSchema.parse(await browser.runtime.sendMessage({ preferences, type: 'preferences.quick.write', version }));
  if (!response.ok) throw new Error(response.error);
  return response.preferences;
}
