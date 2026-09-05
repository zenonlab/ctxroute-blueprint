import { z } from 'zod';
import { popupContinuationRecordSchema } from '@tobirink/application';

export const extensionMessageVersion = 1 as const;
export const navigationTargets = ['library', 'review', 'agenda', 'settings'] as const;

const navigationMessageSchema = z.strictObject({
  target: z.enum(navigationTargets),
  type: z.literal('navigation.open'),
  version: z.literal(extensionMessageVersion),
});

const healthMessageSchema = z.strictObject({
  type: z.literal('health.check'),
  version: z.literal(extensionMessageVersion),
});

const popupContextMessageSchema = z.strictObject({
  type: z.literal('popup.context.read'),
  version: z.literal(extensionMessageVersion),
});

export const extensionMessageSchema = z.discriminatedUnion('type', [navigationMessageSchema, healthMessageSchema, popupContextMessageSchema]);
export const popupContextResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    snapshot: z.strictObject({
      active: popupContinuationRecordSchema.optional(),
      continuations: z.array(popupContinuationRecordSchema),
    }),
  }),
  z.strictObject({ error: z.string(), ok: z.literal(false) }),
]);
export type ExtensionMessage = z.infer<typeof extensionMessageSchema>;
export type NavigationTarget = (typeof navigationTargets)[number];
export type PopupContextResponse = z.infer<typeof popupContextResponseSchema>;

export async function sendExtensionMessage(message: ExtensionMessage): Promise<void> {
  await browser.runtime.sendMessage(message);
}

export async function readPopupContextMessage(): Promise<Extract<PopupContextResponse, { ok: true }>['snapshot']> {
  const response = popupContextResponseSchema.parse(await browser.runtime.sendMessage({ type: 'popup.context.read', version: 1 }));
  if (!response.ok) throw new Error(response.error);
  return response.snapshot;
}
