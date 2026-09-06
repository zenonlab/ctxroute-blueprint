import { z } from 'zod';
import { organizerConfigurationSchema, popupContinuationRecordSchema } from '@tobirink/application';
import { librarySearchMessageSchema, searchOpenMessageSchema } from './library-search-messages';
import { reviewCandidatesMessageSchema, reviewDecisionMessageSchema, reviewQueueMessageSchema } from './review-messages';
import { quickPreferencesReadMessageSchema, quickPreferencesWriteMessageSchema } from './preference-messages';
export { librarySearchResponseSchema, openSearchMessage, readLibrarySearchMessage } from './library-search-messages';
export type { LibrarySearchResponse } from './library-search-messages';
export { readReviewCandidatesMessage, readReviewQueueMessage, reviewCandidatesResponseSchema, reviewDecisionResponseSchema, reviewQueueResponseSchema, writeReviewDecisionMessage } from './review-messages';
export type { ReviewCandidatesResponse, ReviewQueueResponse } from './review-messages';
export { quickPreferencesResponseSchema, readQuickPreferencesMessage, writeQuickPreferencesMessage } from './preference-messages';
export type { QuickPreferencesResponse } from './preference-messages';

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

const organizerConfigurationReadMessageSchema = z.strictObject({
  type: z.literal('organizer.configuration.read'),
  version: z.literal(extensionMessageVersion),
});

const organizerConfigurationWriteMessageSchema = z.strictObject({
  configuration: organizerConfigurationSchema,
  type: z.literal('organizer.configuration.write'),
  version: z.literal(extensionMessageVersion),
});

const organizerPreviewReadMessageSchema = z.strictObject({
  configuration: organizerConfigurationSchema,
  type: z.literal('organizer.preview.read'),
  version: z.literal(extensionMessageVersion),
});

export const extensionMessageSchema = z.discriminatedUnion('type', [navigationMessageSchema, healthMessageSchema, popupContextMessageSchema, reviewQueueMessageSchema, reviewCandidatesMessageSchema, reviewDecisionMessageSchema, libraryPageMessageSchema, librarySearchMessageSchema, searchOpenMessageSchema, agendaPeriodMessageSchema, quickPreferencesReadMessageSchema, quickPreferencesWriteMessageSchema, organizerConfigurationReadMessageSchema, organizerConfigurationWriteMessageSchema, organizerPreviewReadMessageSchema]);
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
const organizerPreviewItemSchema = z.strictObject({
  action: z.enum(['keep', 'move']),
  bookmarkId: z.string().min(1),
  destination: z.array(z.string().min(1)).max(8).optional(),
  reason: z.enum(['already-in-destination', 'insufficient-context', 'no-match', 'unrecognized']).optional(),
  ruleId: z.string().optional(),
  title: z.string().min(1),
});
export const organizerConfigurationResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ configuration: organizerConfigurationSchema.optional(), ok: z.literal(true) }),
  z.strictObject({ error: z.string(), ok: z.literal(false) }),
]);
export const organizerPreviewResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    snapshot: z.strictObject({
      inspectedCount: z.number().int().min(0).max(500),
      items: z.array(organizerPreviewItemSchema).max(500),
      state: z.enum(['partial', 'ready']),
      truncated: z.boolean(),
    }),
  }),
  z.strictObject({ error: z.string(), ok: z.literal(false) }),
]);
export type ExtensionMessage = z.infer<typeof extensionMessageSchema>;
export type NavigationTarget = (typeof navigationTargets)[number];
export type PopupContextResponse = z.infer<typeof popupContextResponseSchema>;
export type LibraryPageResponse = z.infer<typeof libraryPageResponseSchema>;
export type AgendaPeriodResponse = z.infer<typeof agendaPeriodResponseSchema>;
export type OrganizerConfigurationResponse = z.infer<typeof organizerConfigurationResponseSchema>;
export type OrganizerPreviewResponse = z.infer<typeof organizerPreviewResponseSchema>;

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

export async function readOrganizerConfigurationMessage(): Promise<Extract<OrganizerConfigurationResponse, { ok: true }>['configuration']> {
  const response = organizerConfigurationResponseSchema.parse(await browser.runtime.sendMessage({ type: 'organizer.configuration.read', version: extensionMessageVersion }));
  if (!response.ok) throw new Error(response.error);
  return response.configuration;
}

export async function writeOrganizerConfigurationMessage(configuration: z.infer<typeof organizerConfigurationSchema>): Promise<z.infer<typeof organizerConfigurationSchema>> {
  const response = organizerConfigurationResponseSchema.parse(await browser.runtime.sendMessage({ configuration, type: 'organizer.configuration.write', version: extensionMessageVersion }));
  if (!response.ok || response.configuration === undefined) throw new Error(response.ok ? 'Organizer configuration was not returned.' : response.error);
  return response.configuration;
}

export async function readOrganizerPreviewMessage(configuration: z.infer<typeof organizerConfigurationSchema>): Promise<Extract<OrganizerPreviewResponse, { ok: true }>['snapshot']> {
  const response = organizerPreviewResponseSchema.parse(await browser.runtime.sendMessage({ configuration, type: 'organizer.preview.read', version: extensionMessageVersion }));
  if (!response.ok) throw new Error(response.error);
  return response.snapshot;
}
