import { validatePrivateSnapshot } from '@tobirink/application';
import { privateRecoveryJournalSchema } from '@tobirink/application';
import type { FavoriteOwnerLocalStatePort, PrivateRecoveryJournalPort, PrivateSnapshot, RecoveryStorePort } from '@tobirink/application';
import type { Table } from 'dexie';
import type { TobirinkDatabase } from '../database';

type SnapshotTable = Table<unknown, string>;

function snapshotTables(database: TobirinkDatabase): SnapshotTable[] {
  // SAFETY: Dexie transaction scopes use only each table identity; record value types are never read through this widened array.
  return [
    database.agenda, database.favoriteArtifacts, database.favoriteBookmarkMutations, database.favoriteInventoryCheckpoints,
    database.favoriteInventoryMarks, database.favoriteProviderRateCheckpoints, database.favoriteResolutionReceipts,
    database.favoriteReviewCandidateSets, database.favoriteResolutionTasks, database.favoriteSources, database.libraries,
    database.organizer, database.privateRecoveryReceipts, database.progress, database.providerIdentityRecovery, database.reminders, database.reviews, database.works,
  ] as SnapshotTable[];
}

export class DexiePrivateRecoveryStore implements RecoveryStorePort {
  constructor(private readonly database: TobirinkDatabase, private readonly owner?: FavoriteOwnerLocalStatePort, private readonly journal?: PrivateRecoveryJournalPort) {}

  private async readDatabaseSnapshot(): Promise<PrivateSnapshot> {
    const [agenda, favoriteSources, libraries, organizer, progress, reminders, reviews, works] = await this.database.transaction(
      'r', snapshotTables(this.database),
      async () => Promise.all([
        this.database.agenda.toArray(), this.database.favoriteSources.toArray(), this.database.libraries.toArray(),
        this.database.organizer.get('organizer'), this.database.progress.toArray(), this.database.reminders.toArray(),
        this.database.reviews.toArray(), this.database.works.toArray(),
      ]),
    );
    const base: PrivateSnapshot = { agenda, favoriteSources, libraries, progress, reminders, reviews, works };
    return organizer === undefined ? base : { ...base, organizer };
  }

  private async writeDatabaseSnapshot(snapshot: PrivateSnapshot, receiptId?: string): Promise<void> {
    await this.database.transaction('rw', snapshotTables(this.database), async () => {
      await Promise.all(snapshotTables(this.database).map(async (table) => table.clear()));
      await Promise.all([
        this.database.agenda.bulkPut([...snapshot.agenda]), this.database.favoriteSources.bulkPut([...snapshot.favoriteSources]),
        this.database.libraries.bulkPut([...snapshot.libraries]), this.database.progress.bulkPut([...snapshot.progress]),
        this.database.reminders.bulkPut([...snapshot.reminders]), this.database.reviews.bulkPut([...snapshot.reviews]),
        this.database.works.bulkPut([...snapshot.works]),
        snapshot.organizer === undefined ? Promise.resolve() : this.database.organizer.put(snapshot.organizer),
      ]);
      if (receiptId !== undefined) await this.database.privateRecoveryReceipts.put({ committedAt: new Date().toISOString(), id: receiptId });
    });
  }

  async readSnapshot(): Promise<PrivateSnapshot> {
    const [databaseSnapshot, collectiveOwner] = await Promise.all([this.readDatabaseSnapshot(), this.owner?.read()]);
    return validatePrivateSnapshot(collectiveOwner === undefined ? databaseSnapshot : { ...databaseSnapshot, collectiveOwner });
  }

  async replaceSnapshot(input: PrivateSnapshot): Promise<void> {
    const snapshot = validatePrivateSnapshot(input);
    if (snapshot.collectiveOwner === undefined || this.owner === undefined) {
      await this.writeDatabaseSnapshot(snapshot);
      return;
    }
    if (this.journal === undefined) throw new Error('Private recovery journal is required when restoring owner credentials.');
    const previousOwner = await this.owner.read();
    const journalId = crypto.randomUUID();
    const journal = privateRecoveryJournalSchema.parse(previousOwner === undefined
      ? { id: journalId, schemaVersion: 1 }
      : { id: journalId, previousOwner, schemaVersion: 1 });
    await this.journal.save(journal);
    try {
      await this.owner.save(snapshot.collectiveOwner);
      await this.writeDatabaseSnapshot(snapshot, journal.id);
    } catch (error) {
      if (previousOwner !== undefined) await this.owner.save(previousOwner);
      else if (this.owner.clear !== undefined) await this.owner.clear();
      await this.journal.clear().catch(() => undefined);
      throw error;
    }
    await this.journal.clear().catch(() => undefined);
  }

  async recoverInterrupted(): Promise<void> {
    if (this.owner === undefined || this.journal === undefined) return;
    const journal = await this.journal.read();
    if (journal === undefined) return;
    const committed = await this.database.privateRecoveryReceipts.get(journal.id);
    if (committed === undefined) {
      if (journal.previousOwner !== undefined) await this.owner.save(journal.previousOwner);
      else if (this.owner.clear !== undefined) await this.owner.clear();
    }
    await this.journal.clear();
  }
}
