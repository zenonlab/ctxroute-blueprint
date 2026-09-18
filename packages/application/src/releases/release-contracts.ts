import { z } from 'zod';
const containsAsciiControlCharacter = (value: string) => [...value].some(character => {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || code === 0x7f;
});
const dateSchema = z.iso.date();
const instantSchema = z.iso.datetime({ offset: false });
export const releaseOccurrenceSchema = z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('DATE'), value: dateSchema }), z.strictObject({ kind: z.literal('INSTANT'), value: instantSchema })]);
const releaseSequenceSchema = z.union([
  z.number().int().nonnegative(),
  z.string().trim().min(1).max(64).refine(value => !containsAsciiControlCharacter(value), 'must contain printable characters'),
]);
const publicReleaseFields = { id: z.string().min(1).max(128), providerWorkId: z.string().min(1).max(128), releaseKind: z.enum(['episode', 'chapter', 'volume', 'special']), occurrence: releaseOccurrenceSchema, state: z.enum(['SCHEDULED', 'CONFIRMED', 'ESTIMATED', 'CANCELLED']), provenance: z.strictObject({ source: z.string().min(1).max(128), fetchedAt: z.iso.datetime({ offset: false }), parserVersion: z.string().min(1).max(32), rulesVersion: z.string().min(1).max(32) }), expiresAt: z.iso.datetime({ offset: false }) } as const;
const canonicalPublicReleaseEventSchema = z.strictObject({ ...publicReleaseFields, provider: z.enum(['anilist', 'mangaupdates']), sequence: z.string().min(1).max(64).optional() });
export const publicReleaseEventSchema = z.strictObject({ ...publicReleaseFields, provider: z.enum(['anilist', 'mangaupdates', 'mangaUpdates']), sequence: releaseSequenceSchema.optional() }).transform(({ provider, sequence, ...event }) => {
  const canonical = { ...event, provider: provider === 'mangaUpdates' ? 'mangaupdates' as const : provider };
  return sequence === undefined ? canonical : { ...canonical, sequence: String(sequence) };
}).pipe(canonicalPublicReleaseEventSchema);
export const localReleaseEvidenceSchema = z.strictObject({ id: z.string().min(1).max(128), publicReleaseId: z.string().min(1).max(128), workId: z.string().min(1).max(128), observedAt: z.iso.datetime({ offset: false }), source: z.enum(['public', 'manual']), occurrence: releaseOccurrenceSchema, state: z.enum(['SCHEDULED', 'CONFIRMED', 'ESTIMATED', 'CANCELLED']), provider: z.enum(['anilist', 'mangaupdates']).optional(), providerWorkId: z.string().min(1).max(128).optional(), releaseKind: z.enum(['episode', 'chapter', 'volume', 'special']).optional(), sequence: z.string().min(1).max(64).optional() });
export const localAgendaEventSchema = z.strictObject({ id: z.string().min(1).max(128), workId: z.string().min(1).max(128), evidenceId: z.string().min(1).max(128), occurrence: releaseOccurrenceSchema, availability: z.enum(['confirmed', 'estimated', 'official', 'unavailable']), releaseLabel: z.string().min(1).max(160) });
export const localNotificationDeliverySchema = z.strictObject({ id: z.string().min(1).max(128), agendaEventId: z.string().min(1).max(128), deduplicationKey: z.string().min(1).max(256), channel: z.literal('native'), status: z.enum(['pending', 'claimed', 'delivered', 'dismissed']), availableAt: z.iso.datetime({ offset: false }), claimedAt: z.iso.datetime({ offset: false }).optional(), deliveredAt: z.iso.datetime({ offset: false }).optional() });
export const virtualReleaseModelSchema = z.strictObject({
  workId: z.string().min(1).max(128),
  provider: z.enum(['anilist', 'mangaupdates']),
  providerWorkId: z.string().min(1).max(128),
  releaseKind: z.enum(['episode', 'chapter', 'volume', 'special']),
  anchor: z.strictObject({ date: dateSchema, sequence: z.string().min(1).max(64).optional() }),
  intervalDays: z.number().positive().max(366).optional(),
  explicitNext: publicReleaseEventSchema.optional(),
  exceptions: z.array(publicReleaseEventSchema).max(32),
  validity: z.strictObject({ from: dateSchema, to: dateSchema }),
  editorialStatus: z.enum(['UPCOMING', 'ONGOING', 'HIATUS', 'COMPLETED', 'CANCELLED', 'UNKNOWN']),
  provenance: z.strictObject({ source: z.string().min(1).max(128), observedAt: instantSchema, parserVersion: z.string().min(1).max(32), rulesVersion: z.string().min(1).max(32) }),
  revision: z.string().min(1).max(128),
});
export type PublicReleaseEventInput = z.input<typeof publicReleaseEventSchema>;
export type PublicReleaseEventContract = z.output<typeof publicReleaseEventSchema>;
export type LocalReleaseEvidenceContract = z.output<typeof localReleaseEvidenceSchema>;
export type LocalAgendaEventContract = z.output<typeof localAgendaEventSchema>;
export type LocalNotificationDeliveryContract = z.output<typeof localNotificationDeliverySchema>;
export type VirtualReleaseModelContract = z.output<typeof virtualReleaseModelSchema>;
export type VirtualReleaseModelInput = z.input<typeof virtualReleaseModelSchema>;
