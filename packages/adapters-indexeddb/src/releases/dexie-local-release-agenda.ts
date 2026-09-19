import Dexie from 'dexie';
import { localAgendaEventSchema, localReleaseEvidenceSchema } from '@tobirink/application';
import type { LocalReleaseAgendaPort } from '@tobirink/application';
import type { LocalAgendaEvent, LocalReleaseEvidence, WorkId } from '@tobirink/domain';
import { agendaEntryId, createAgendaEntry, workId } from '@tobirink/domain';
import type { TobirinkDatabase } from '../database';

export class DexieLocalReleaseAgenda implements LocalReleaseAgendaPort {
  constructor(private readonly database: TobirinkDatabase) {}
  async commit(revision: string, evidence: readonly LocalReleaseEvidence[], events: readonly LocalAgendaEvent[]): Promise<void> {
    if (!/^[A-Za-z0-9._-]{1,64}$/u.test(revision)) throw new TypeError('Invalid local Agenda revision.');
    const validEvidence = evidence.map((item) => localReleaseEvidenceSchema.parse(item));
    const validEvents = events.map((item) => localAgendaEventSchema.parse(item));
    await this.database.transaction('rw', this.database.localReleaseEvidence, this.database.localAgendaEvents, this.database.localAgendaProjectionState, this.database.agenda, async () => {
      const active = await this.database.localAgendaProjectionState.get('active');
      const previous = active?.eventIds === undefined
        ? await this.database.localAgendaEvents.limit(10_001).toArray()
        : (await this.database.localAgendaEvents.bulkGet(active.eventIds)).filter((event): event is LocalAgendaEvent => event !== undefined);
      if (previous.length > 10_000) throw new Error('local-agenda-history-limit');
      const nextIds = new Set(validEvents.map(event => event.id));
      for (const event of previous) {
        if (nextIds.has(event.id)) continue;
        const record = await this.database.localReleaseEvidence.get(event.evidenceId);
        if (record?.source !== 'public') { nextIds.add(event.id); continue; }
        for (const id of [event.id, `agenda_${event.id}`]) {
          const entry = await this.database.agenda.get(id);
          if (entry !== undefined) {
            const { occursAt: _previousDate, ...retained } = entry;
            await this.database.agenda.put(createAgendaEntry({ ...retained, availability: 'unavailable' }));
          }
        }
      }
      await this.database.localReleaseEvidence.bulkPut(validEvidence);
      await this.database.localAgendaEvents.bulkPut(validEvents);
      for (const event of validEvents) {
        if (event.occurrence.kind !== 'INSTANT') continue;
        await this.database.agenda.put(createAgendaEntry({ id: agendaEntryId(`agenda_${event.id}`), workId: workId(event.workId), availability: event.availability, occursAt: event.occurrence.value, releaseLabel: event.releaseLabel }));
      }
      await this.database.localAgendaProjectionState.put({ id: 'active', revision, eventIds: [...nextIds] });
    });
  }
  async isCurrent(revision: string): Promise<boolean> { return (await this.database.localAgendaProjectionState.get('active'))?.revision === revision; }
  async listEvidence(workId: WorkId, limit: number): Promise<readonly LocalReleaseEvidence[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new RangeError('Local release evidence limit must be between 1 and 12.');
    const records = await this.database.localReleaseEvidence.where('[workId+occurrence.value]').between([workId, Dexie.minKey], [workId, Dexie.maxKey], true, true).reverse().limit(limit).toArray();
    return records.map((item) => localReleaseEvidenceSchema.parse(item)).sort((left, right) => left.occurrence.value.localeCompare(right.occurrence.value) || left.id.localeCompare(right.id));
  }
  async listPeriod(from: string, to: string, limit: number, after?: { occurrence: string; id: string }): Promise<readonly LocalAgendaEvent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || from >= to) throw new RangeError('Invalid local Agenda period.');
    const active = await this.database.localAgendaProjectionState.get('active');
    const ids = active?.eventIds === undefined ? undefined : new Set(active.eventIds);
    return (await this.database.localAgendaEvents.where('occurrence.value').between(after?.occurrence ?? from, to, true, false)
      .filter(event => (ids === undefined || ids.has(event.id)) && (after === undefined || event.occurrence.value > after.occurrence || (event.occurrence.value === after.occurrence && event.id > after.id)))
      .limit(limit).toArray()).map((item) => localAgendaEventSchema.parse(item));
  }
}
