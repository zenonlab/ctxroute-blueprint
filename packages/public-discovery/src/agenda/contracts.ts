import { z } from 'zod';

const containsAsciiControlCharacter = (value: string) => [...value].some(character => {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || code === 0x7f;
});

const releaseSequenceSchema = z.union([
  z.number().int().nonnegative(),
  z.string().trim().min(1).max(64).refine(value => !containsAsciiControlCharacter(value), 'must contain printable characters'),
]);
const releaseOccurrenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('DATE'), value: z.iso.date() }),
  z.strictObject({ kind: z.literal('INSTANT'), value: z.iso.datetime({ offset: false }) }),
]);
const publicReleaseFields = {
  expiresAt: z.iso.datetime({ offset: false }), id: z.string().min(1).max(128), occurrence: releaseOccurrenceSchema,
  provenance: z.strictObject({ fetchedAt: z.iso.datetime({ offset: false }), parserVersion: z.string().min(1).max(32), rulesVersion: z.string().min(1).max(32), source: z.string().min(1).max(128) }),
  providerWorkId: z.string().min(1).max(128), releaseKind: z.enum(['episode', 'chapter', 'volume', 'special']),
  state: z.enum(['SCHEDULED', 'CONFIRMED', 'ESTIMATED', 'CANCELLED']),
} as const;
const canonicalReleaseSchema = z.strictObject({ ...publicReleaseFields, provider: z.enum(['anilist', 'mangaupdates']), sequence: z.string().min(1).max(64).optional() });

export const publicAgendaReleaseEventSchema = z.strictObject({
  ...publicReleaseFields, provider: z.enum(['anilist', 'mangaupdates', 'mangaUpdates']), sequence: releaseSequenceSchema.optional(),
}).transform(({ provider, sequence, ...event }) => {
  const canonical = { ...event, provider: provider === 'mangaUpdates' ? 'mangaupdates' as const : provider };
  return sequence === undefined ? canonical : { ...canonical, sequence: String(sequence) };
}).pipe(canonicalReleaseSchema);

export const publicAgendaPageCheckpointSchema = z.strictObject({
  complete: z.boolean(), events: z.array(publicAgendaReleaseEventSchema).max(5_000),
  nextPage: z.number().int().positive().optional(), notBefore: z.number().int().nonnegative().optional(),
  page: z.number().int().positive(), provider: z.enum(['anilist', 'mangaupdates']),
  received: z.number().int().nonnegative(), skippedUnidentified: z.number().int().nonnegative(),
});

export interface PublicAgendaPageCheckpoint {
  readonly complete: boolean;
  readonly events: readonly z.output<typeof publicAgendaReleaseEventSchema>[];
  readonly nextPage?: number | undefined;
  readonly notBefore?: number | undefined;
  readonly page: number;
  readonly provider: 'anilist' | 'mangaupdates';
  readonly received: number;
  readonly skippedUnidentified: number;
}

export const publicAgendaIngestionSchema = z.strictObject({
  events: z.array(publicAgendaReleaseEventSchema).max(5_000), generatedAt: z.iso.datetime({ offset: false }), nonce: z.uuid(), schemaVersion: z.literal(1),
  window: z.strictObject({ from: z.iso.date(), to: z.iso.date() }),
}).superRefine((value, context) => {
  if (value.window.from > value.window.to || Date.parse(`${value.window.to}T00:00:00.000Z`) - Date.parse(`${value.window.from}T00:00:00.000Z`) > 40 * 86_400_000) context.addIssue({ code: 'custom', message: 'invalid-ingestion-window', path: ['window'] });
  const ids = new Set<string>();
  for (const [index, event] of value.events.entries()) {
    if (ids.has(event.id)) context.addIssue({ code: 'custom', message: 'duplicate-event', path: ['events', index, 'id'] });
    ids.add(event.id);
    const date = event.occurrence.value.slice(0, 10);
    if (date < value.window.from || date > value.window.to) context.addIssue({ code: 'custom', message: 'event-outside-window', path: ['events', index, 'occurrence'] });
  }
});

export const publicAgendaReceiptSchema = z.strictObject({
  accepted: z.boolean(), count: z.number().int().nonnegative(), replayed: z.boolean(), revision: z.string().regex(/^calendar-[a-f0-9]{48}$/u),
});

export type PublicAgendaIngestion = z.output<typeof publicAgendaIngestionSchema>;
export type PublicAgendaReleaseEvent = z.output<typeof publicAgendaReleaseEventSchema>;
