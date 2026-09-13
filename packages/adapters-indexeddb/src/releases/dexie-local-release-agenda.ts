import Dexie from 'dexie';
import { localAgendaEventSchema, localReleaseEvidenceSchema } from '@tobirink/application';
import type { LocalReleaseAgendaPort } from '@tobirink/application';
import type { LocalAgendaEvent, LocalReleaseEvidence, WorkId } from '@tobirink/domain';
import type { TobirinkDatabase } from '../database';

export class DexieLocalReleaseAgenda implements LocalReleaseAgendaPort {
  constructor(private readonly database: TobirinkDatabase) {}
  async commit(revision: string, evidence: readonly LocalReleaseEvidence[], events: readonly LocalAgendaEvent[]): Promise<void> {
    if (!/^[A-Za-z0-9._-]{1,64}$/u.test(revision)) throw new TypeError('Invalid local Agenda revision.');
    const validEvidence = evidence.map((item) => localReleaseEvidenceSchema.parse(item));
    const validEvents = events.map((item) => localAgendaEventSchema.parse(item));
    await this.database.transaction('rw', this.database.localReleaseEvidence, this.database.localAgendaEvents, this.database.localAgendaProjectionState, async () => {
      await this.database.localReleaseEvidence.bulkPut(validEvidence);
      await this.database.localAgendaEvents.clear();
      await this.database.localAgendaEvents.bulkPut(validEvents);
      await this.database.localAgendaProjectionState.put({ id: 'active', revision });
    });
  }
  async isCurrent(revision: string): Promise<boolean> { return (await this.database.localAgendaProjectionState.get('active'))?.revision === revision; }
  async listEvidence(workId: WorkId, limit: number): Promise<readonly LocalReleaseEvidence[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 12) throw new RangeError('Local release evidence limit must be between 1 and 12.');
    const records = await this.database.localReleaseEvidence.where('[workId+occurrence.value]').between([workId, Dexie.minKey], [workId, Dexie.maxKey], true, true).reverse().limit(limit).toArray();
    return records.map((item) => localReleaseEvidenceSchema.parse(item)).sort((left, right) => left.occurrence.value.localeCompare(right.occurrence.value) || left.id.localeCompare(right.id));
  }
  async listPeriod(from: string, to: string, limit: number): Promise<readonly LocalAgendaEvent[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || from >= to) throw new RangeError('Invalid local Agenda period.');
    return (await this.database.localAgendaEvents.where('occurrence.value').between(from, to, true, false).limit(limit).toArray()).map((item) => localAgendaEventSchema.parse(item)).sort((left, right) => left.occurrence.value.localeCompare(right.occurrence.value) || left.id.localeCompare(right.id));
  }
}
