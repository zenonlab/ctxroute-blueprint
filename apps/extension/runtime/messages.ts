import { z } from 'zod';
import { popupContinuationRecordSchema } from '@tobirink/application';
import { webHandshakeSchema, webRequestEnvelopeSchema } from '@tobirink/contracts/web-bridge';
import { librarySearchMessageSchema, searchOpenMessageSchema } from './library-search-messages';
import { organizerApplyMessageSchema, organizerConfigurationReadMessageSchema, organizerConfigurationWriteMessageSchema, organizerPreviewReadMessageSchema, organizerRestoreMessageSchema } from './organizer-messages';
import { reviewCandidatesMessageSchema, reviewDecisionMessageSchema, reviewQueueMessageSchema } from './review-messages';
import { quickPreferencesReadMessageSchema, quickPreferencesWriteMessageSchema } from './preference-messages';
export { librarySearchResponseSchema, openSearchMessage, readLibrarySearchMessage } from './library-search-messages';
export type { LibrarySearchResponse } from './library-search-messages';
export { readReviewCandidatesMessage, readReviewQueueMessage, reviewCandidatesResponseSchema, reviewDecisionResponseSchema, reviewQueueResponseSchema, writeReviewDecisionMessage } from './review-messages';
export type { ReviewCandidatesResponse, ReviewQueueResponse } from './review-messages';
export { quickPreferencesResponseSchema, readQuickPreferencesMessage, writeQuickPreferencesMessage } from './preference-messages';
export type { QuickPreferencesResponse } from './preference-messages';
export { applyOrganizerPreviewMessage, organizerConfigurationResponseSchema, organizerMutationResponseSchema, organizerPreviewResponseSchema, organizerPreviewSnapshotSchema, readOrganizerConfigurationMessage, readOrganizerPreviewMessage, restoreOrganizerSnapshotMessage, writeOrganizerConfigurationMessage } from './organizer-messages';
export type { OrganizerConfigurationResponse, OrganizerPreviewResponse, OrganizerPreviewSnapshot } from './organizer-messages';

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

const libraryPageMessageSchema = z.strictObject({
  afterId: z.string().regex(/^work_[a-z0-9][a-z0-9_-]{5,}$/u).optional(),
  type: z.literal('library.page.read'),
  version: z.literal(extensionMessageVersion),
});

const agendaPeriodMessageSchema = z.strictObject({
  from: z.string(),
  to: z.string(),
  type: z.literal('agenda.period.read'),
  version: z.literal(extensionMessageVersion),
});

const webBridgeHandshakeMessageSchema = z.strictObject({
  handshake: webHandshakeSchema,
  type: z.literal('webbridge.handshake'),
});

const webBridgeRequestMessageSchema = z.strictObject({
  envelope: webRequestEnvelopeSchema,
  type: z.literal('webbridge.request'),
});

export const extensionMessageSchema = z.discriminatedUnion('type', [navigationMessageSchema, healthMessageSchema, popupContextMessageSchema, reviewQueueMessageSchema, reviewCandidatesMessageSchema, reviewDecisionMessageSchema, libraryPageMessageSchema, librarySearchMessageSchema, searchOpenMessageSchema, agendaPeriodMessageSchema, quickPreferencesReadMessageSchema, quickPreferencesWriteMessageSchema, organizerConfigurationReadMessageSchema, organizerConfigurationWriteMessageSchema, organizerPreviewReadMessageSchema, organizerApplyMessageSchema, organizerRestoreMessageSchema, webBridgeHandshakeMessageSchema, webBridgeRequestMessageSchema]);
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
export const agendaPeriodResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    snapshot: z.strictObject({
      items: z.array(z.strictObject({
        availability: z.enum(['confirmed', 'estimated', 'official', 'unavailable']),
        id: z.string().regex(/^agenda_[a-z0-9][a-z0-9_-]{5,}$/u),
        mediaType: z.enum(['anime', 'manga']),
        occursAt: z.string(),
        release: z.string().min(1).max(300),
        source: z.string().min(1).max(32),
        sourceUrl: z.string().regex(/^https?:\/\/[^\s]+$/u).optional(),
        title: z.string().min(1).max(300),
        workId: z.string().regex(/^work_[a-z0-9][a-z0-9_-]{5,}$/u),
      })).max(100),
      missingWorkIds: z.array(z.string().regex(/^work_[a-z0-9][a-z0-9_-]{5,}$/u)).max(100),
      source: z.enum(['cache', 'local']),
      updatedAt: z.string(),
    }),
  }),
  z.strictObject({ error: z.string(), ok: z.literal(false) }),
]);
export type ExtensionMessage = z.infer<typeof extensionMessageSchema>;
export type NavigationTarget = (typeof navigationTargets)[number];
export type PopupContextResponse = z.infer<typeof popupContextResponseSchema>;
export type LibraryPageResponse = z.infer<typeof libraryPageResponseSchema>;
export type AgendaPeriodResponse = z.infer<typeof agendaPeriodResponseSchema>;

export async function sendExtensionMessage(message: ExtensionMessage): Promise<void> {
  await browser.runtime.sendMessage(message);
}

export async function readPopupContextMessage(): Promise<Extract<PopupContextResponse, { ok: true }>['snapshot']> {
  const response = popupContextResponseSchema.parse(await browser.runtime.sendMessage({ type: 'popup.context.read', version: 1 }));
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

export async function readAgendaPeriodMessage(from: string, to: string): Promise<Extract<AgendaPeriodResponse, { ok: true }>['snapshot']> {
  const response = agendaPeriodResponseSchema.parse(await browser.runtime.sendMessage({ from, to, type: 'agenda.period.read', version: extensionMessageVersion }));
  if (!response.ok) throw new Error(response.error);
  return response.snapshot;
}
