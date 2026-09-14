import { validatePrivateSnapshot } from '@tobirink/application';
import type { PrivateSnapshot, RecoveryStorePort } from '@tobirink/application';
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
  constructor(private readonly database: TobirinkDatabase) {}

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
    return validatePrivateSnapshot(await this.readDatabaseSnapshot());
  }

  async replaceSnapshot(input: PrivateSnapshot): Promise<void> {
    const snapshot = validatePrivateSnapshot(input);
    await this.writeDatabaseSnapshot(snapshot);
  }
}
