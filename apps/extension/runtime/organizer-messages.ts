import { z } from 'zod';
import { organizerConfigurationSchema } from '@tobirink/application';

const version = 1 as const;
const organizerPreviewItemSchema = z.strictObject({
  action: z.enum(['keep', 'move']), bookmarkId: z.string().min(1), destination: z.array(z.string().min(1)).max(8).optional(),
  reason: z.enum(['already-in-destination', 'insufficient-context', 'no-match', 'unrecognized']).optional(), ruleId: z.string().optional(), title: z.string().min(1),
});
export const organizerPreviewSnapshotSchema = z.strictObject({ inspectedCount: z.number().int().min(0).max(500), items: z.array(organizerPreviewItemSchema).max(500), state: z.enum(['partial', 'ready']), truncated: z.boolean() });
export const organizerConfigurationReadMessageSchema = z.strictObject({ type: z.literal('organizer.configuration.read'), version: z.literal(version) });
export const organizerConfigurationWriteMessageSchema = z.strictObject({ configuration: organizerConfigurationSchema, type: z.literal('organizer.configuration.write'), version: z.literal(version) });
export const organizerPreviewReadMessageSchema = z.strictObject({ configuration: organizerConfigurationSchema, type: z.literal('organizer.preview.read'), version: z.literal(version) });
export const organizerApplyMessageSchema = z.strictObject({ configuration: organizerConfigurationSchema, confirmation: z.literal('apply-organizer-preview'), expected: organizerPreviewSnapshotSchema, type: z.literal('organizer.preview.apply'), version: z.literal(version) });
export const organizerRestoreMessageSchema = z.strictObject({ confirmation: z.literal('restore-organizer-snapshot'), type: z.literal('organizer.snapshot.restore'), version: z.literal(version) });
export const organizerConfigurationResponseSchema = z.discriminatedUnion('ok', [z.strictObject({ canRestore: z.boolean(), configuration: organizerConfigurationSchema.optional(), ok: z.literal(true) }), z.strictObject({ error: z.string(), ok: z.literal(false) })]);
export const organizerPreviewResponseSchema = z.discriminatedUnion('ok', [z.strictObject({ ok: z.literal(true), snapshot: organizerPreviewSnapshotSchema }), z.strictObject({ error: z.string(), ok: z.literal(false) })]);
export const organizerMutationResponseSchema = z.discriminatedUnion('ok', [z.strictObject({ moved: z.number().int().nonnegative().optional(), ok: z.literal(true), restored: z.number().int().nonnegative().optional(), skipped: z.number().int().nonnegative() }), z.strictObject({ error: z.string(), ok: z.literal(false) })]);
export type OrganizerConfigurationResponse = z.infer<typeof organizerConfigurationResponseSchema>;
export type OrganizerPreviewResponse = z.infer<typeof organizerPreviewResponseSchema>;
export type OrganizerPreviewSnapshot = z.infer<typeof organizerPreviewSnapshotSchema>;

export async function readOrganizerConfigurationMessage(): Promise<Pick<Extract<OrganizerConfigurationResponse, { ok: true }>, 'canRestore' | 'configuration'>> {
  const response = organizerConfigurationResponseSchema.parse(await browser.runtime.sendMessage({ type: 'organizer.configuration.read', version }));
  if (!response.ok) throw new Error(response.error);
  return { canRestore: response.canRestore, configuration: response.configuration };
}
export async function writeOrganizerConfigurationMessage(configuration: z.infer<typeof organizerConfigurationSchema>): Promise<z.infer<typeof organizerConfigurationSchema>> {
  const response = organizerConfigurationResponseSchema.parse(await browser.runtime.sendMessage({ configuration, type: 'organizer.configuration.write', version }));
  if (!response.ok || response.configuration === undefined) throw new Error(response.ok ? 'Organizer configuration was not returned.' : response.error);
  return response.configuration;
}
export async function readOrganizerPreviewMessage(configuration: z.infer<typeof organizerConfigurationSchema>): Promise<OrganizerPreviewSnapshot> {
  const response = organizerPreviewResponseSchema.parse(await browser.runtime.sendMessage({ configuration, type: 'organizer.preview.read', version }));
  if (!response.ok) throw new Error(response.error);
  return response.snapshot;
}
export async function applyOrganizerPreviewMessage(configuration: z.infer<typeof organizerConfigurationSchema>, expected: OrganizerPreviewSnapshot) {
  const response = organizerMutationResponseSchema.parse(await browser.runtime.sendMessage({ configuration, confirmation: 'apply-organizer-preview', expected, type: 'organizer.preview.apply', version }));
  if (!response.ok) throw new Error(response.error);
  return response;
}
export async function restoreOrganizerSnapshotMessage() {
  const response = organizerMutationResponseSchema.parse(await browser.runtime.sendMessage({ confirmation: 'restore-organizer-snapshot', type: 'organizer.snapshot.restore', version }));
  if (!response.ok) throw new Error(response.error);
  return response;
}
