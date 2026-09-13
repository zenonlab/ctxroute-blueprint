import { agendaEntryId, createAgendaEntry, workId } from '@tobirink/domain';
import type { PublicReleaseEventContract } from '../releases/release-contracts';
import type { AgendaEntry, Work } from '@tobirink/domain';
export function projectLocalAgenda(events: readonly PublicReleaseEventContract[], works: readonly Work[]): readonly AgendaEntry[] {
  const byProvider = new Map<string, Map<string, Work>>();
  for (const work of works) for (const ref of work.externalReferences) { const ids = byProvider.get(ref.provider) ?? new Map<string, Work>(); ids.set(ref.externalId, work); byProvider.set(ref.provider, ids); }
  const projected: AgendaEntry[] = [];
  for (const event of events) { const work = byProvider.get(event.provider)?.get(event.providerWorkId); if (!work || event.occurrence.kind !== 'INSTANT') continue; projected.push(createAgendaEntry({ availability: event.state === 'ESTIMATED' ? 'estimated' : event.state === 'CANCELLED' ? 'unavailable' : 'official', id: agendaEntryId(`agenda_${event.id}`), occursAt: event.occurrence.value, releaseLabel: `${event.releaseKind} ${event.sequence ?? ''}`.trim(), workId: workId(work.id) })); }
  return Object.freeze(projected);
}
