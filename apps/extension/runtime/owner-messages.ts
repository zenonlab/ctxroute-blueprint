import { z } from 'zod';

export const ownerMessageSchema = z.strictObject({ type: z.literal('owner.action'), version: z.literal(1), action: z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('status') }),
  z.strictObject({ kind: z.literal('enable'), consent: z.literal(true) }),
  z.strictObject({ kind: z.literal('revoke') }),
  z.strictObject({ kind: z.literal('pair') }),
  z.strictObject({ kind: z.literal('redeem'), consent: z.literal(true), invitation: z.string().regex(/^[a-f0-9-]{36}:[a-f0-9]{64}$/u) }),
]) });
export const ownerResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), status: z.enum(['unavailable', 'disabled', 'pending', 'enabled', 'revoking', 'revoked']), invitation: z.string().max(101).optional() }),
  z.strictObject({ ok: z.literal(false), error: z.string().max(100) }),
]);
export type OwnerAction = z.infer<typeof ownerMessageSchema>['action'];
export async function sendOwnerAction(action: OwnerAction) {
  const response = ownerResponseSchema.parse(await browser.runtime.sendMessage(ownerMessageSchema.parse({ type: 'owner.action', version: 1, action })));
  if (!response.ok) throw new Error(response.error);
  return response;
}
