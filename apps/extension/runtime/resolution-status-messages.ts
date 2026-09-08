import { z } from 'zod';

export const resolutionStatusMessageSchema = z.strictObject({ type: z.literal('favorite.status.read'), version: z.literal(1) });
export const resolutionStatusResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), counts: z.strictObject({ processing: z.number().int().nonnegative(), retryable: z.number().int().nonnegative(), unsupported: z.number().int().nonnegative() }) }),
  z.strictObject({ ok: z.literal(false), error: z.string() }),
]);

export async function readResolutionStatus() {
  const response = resolutionStatusResponseSchema.parse(await browser.runtime.sendMessage({ type: 'favorite.status.read', version: 1 }));
  if (!response.ok) throw new Error('Favorite status unavailable.');
  return response.counts;
}
