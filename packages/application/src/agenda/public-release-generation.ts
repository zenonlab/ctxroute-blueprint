import { z } from 'zod';
import { agendaEntryId, createAgendaEntry, workId } from '@tobirink/domain';
import type { AgendaEntry, Work, WorkId } from '@tobirink/domain';
import type { StoragePort } from '../ports/storage-port';
import { publicReleaseEventSchema } from '../releases/release-contracts';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u);
export const publicReleaseGenerationSchema = z.strictObject({
  etag: z.string().min(3).max(160),
  events: z.array(publicReleaseEventSchema).max(10_000),
  generatedAt: z.iso.datetime({ offset: false }),
  revision: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/u),
  source: z.enum(['fallback', 'shared']),
  window: z.strictObject({ from: dateSchema, to: dateSchema }),
}).superRefine((generation, context) => {
  if (generation.window.from > generation.window.to) context.addIssue({ code: 'custom', message: 'Invalid release window.', path: ['window'] });
  if (new Set(generation.events.map((event) => event.id)).size !== generation.events.length) context.addIssue({ code: 'custom', message: 'Duplicate release identity.', path: ['events'] });
});
export type PublicReleaseGeneration = z.output<typeof publicReleaseGenerationSchema>;
export interface PublicReleaseGenerationCachePort { load(): Promise<PublicReleaseGeneration | undefined>; save(generation: PublicReleaseGeneration): Promise<void> }

async function listAllWorks(storage: StoragePort): Promise<readonly Work[]> {
  const works: Work[] = [];
  let afterId: WorkId | undefined;
  for (let page = 0; page < 100; page += 1) {
    const result = await storage.listWorks(afterId === undefined ? { limit: 100 } : { afterId, limit: 100 });
    works.push(...result);
    if (result.length < 100) return works;
    afterId = result.at(-1)?.id;
  }
  throw new Error('public-release-work-pagination-limit');
}

export async function hydrateAgendaFromPublicReleaseGeneration(storage: StoragePort, cache: PublicReleaseGenerationCachePort): Promise<{ entries: readonly AgendaEntry[]; generatedAt?: string; missingWorkIds: readonly WorkId[]; state: 'empty' | 'hydrated' }> {
  const input = await cache.load();
  if (input === undefined) return { entries: [], missingWorkIds: [], state: 'empty' };
  const generation = publicReleaseGenerationSchema.parse(input);
  const works = await listAllWorks(storage);
  const identities: { [identity: string]: Work | undefined } = {};
  for (const work of works) for (const reference of work.externalReferences) identities[`${reference.provider}:${reference.externalId}`] = work;
  const entries: AgendaEntry[] = [];
  const missingWorkIds: WorkId[] = [];
  for (const event of generation.events) {
    const identity = `${event.provider}:${event.providerWorkId}`;
    const work = identities[identity];
    if (!work) { missingWorkIds.push(workId(identity)); continue; }
    if (event.occurrence.kind !== 'INSTANT' || event.state === 'CANCELLED') continue;
    entries.push(createAgendaEntry({ availability: event.state === 'ESTIMATED' ? 'estimated' : 'official', id: agendaEntryId(`agenda_${event.id}`), occursAt: event.occurrence.value, releaseLabel: `${event.releaseKind} ${event.sequence ?? ''}`.trim(), workId: work.id }));
  }
  await storage.transaction(['agenda'], async (session) => { for (const entry of entries) await session.putAgendaEntry(entry); });
  return { entries: Object.freeze(entries), generatedAt: generation.generatedAt, missingWorkIds: Object.freeze(missingWorkIds), state: 'hydrated' };
}
