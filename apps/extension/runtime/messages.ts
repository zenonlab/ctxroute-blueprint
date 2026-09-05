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

const reviewQueueMessageSchema = z.strictObject({
  type: z.literal('review.queue.read'),
  version: z.literal(extensionMessageVersion),
});

const libraryPageMessageSchema = z.strictObject({
  afterId: z.string().regex(/^work_[a-z0-9][a-z0-9_-]{5,}$/u).optional(),
  type: z.literal('library.page.read'),
  version: z.literal(extensionMessageVersion),
});

export const extensionMessageSchema = z.discriminatedUnion('type', [navigationMessageSchema, healthMessageSchema, popupContextMessageSchema, reviewQueueMessageSchema, libraryPageMessageSchema]);
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
export const reviewQueueResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    snapshot: z.strictObject({
      items: z.array(z.strictObject({
        id: z.string().regex(/^review_[a-z0-9][a-z0-9_-]{5,}$/u),
        sourceLabel: z.string().min(1),
        title: z.string().min(1),
      })).max(100),
      status: z.literal('pending'),
    }),
  }),
  z.strictObject({ error: z.string(), ok: z.literal(false) }),
]);
export const libraryPageResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    snapshot: z.strictObject({
      items: z.array(z.strictObject({
        id: z.string().regex(/^work_[a-z0-9][a-z0-9_-]{5,}$/u),
        mediaType: z.enum(['anime', 'manga']),
        source: z.string().min(1).max(32),
        title: z.string().min(1).max(300),
      })).max(24),
      missingWorkIds: z.array(z.string().regex(/^work_[a-z0-9][a-z0-9_-]{5,}$/u)).max(24),
      nextCursor: z.string().regex(/^work_[a-z0-9][a-z0-9_-]{5,}$/u).optional(),
    }),
  }),
  z.strictObject({ error: z.string(), ok: z.literal(false) }),
]);
export type ExtensionMessage = z.infer<typeof extensionMessageSchema>;
export type NavigationTarget = (typeof navigationTargets)[number];
export type PopupContextResponse = z.infer<typeof popupContextResponseSchema>;
export type ReviewQueueResponse = z.infer<typeof reviewQueueResponseSchema>;
export type LibraryPageResponse = z.infer<typeof libraryPageResponseSchema>;

export async function sendExtensionMessage(message: ExtensionMessage): Promise<void> {
  await browser.runtime.sendMessage(message);
}

export async function readPopupContextMessage(): Promise<Extract<PopupContextResponse, { ok: true }>['snapshot']> {
  const response = popupContextResponseSchema.parse(await browser.runtime.sendMessage({ type: 'popup.context.read', version: 1 }));
  if (!response.ok) throw new Error(response.error);
  return response.snapshot;
}

export async function readReviewQueueMessage(): Promise<Extract<ReviewQueueResponse, { ok: true }>['snapshot']> {
  const response = reviewQueueResponseSchema.parse(await browser.runtime.sendMessage({ type: 'review.queue.read', version: 1 }));
  if (!response.ok) throw new Error(response.error);
  return response.snapshot;
}

export async function readLibraryPageMessage(afterId?: string): Promise<Extract<LibraryPageResponse, { ok: true }>['snapshot']> {
  const message = afterId
    ? { afterId, type: 'library.page.read' as const, version: extensionMessageVersion }
    : { type: 'library.page.read' as const, version: extensionMessageVersion };
  const response = libraryPageResponseSchema.parse(await browser.runtime.sendMessage(message));
  if (!response.ok) throw new Error(response.error);
  return response.snapshot;
}
