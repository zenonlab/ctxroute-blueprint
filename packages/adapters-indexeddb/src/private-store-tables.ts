import type { PrivateStoreName } from '@tobirink/application';
import type { Table } from 'dexie';
import type { TobirinkDatabase } from './database';

export function privateStoreTables(database: TobirinkDatabase, stores: readonly PrivateStoreName[]): Table[] {
  const tables = {
    agenda: database.agenda,
    favoriteArtifacts: database.favoriteArtifacts,
    favoriteBookmarkMutations: database.favoriteBookmarkMutations,
    favoriteInventoryCheckpoints: database.favoriteInventoryCheckpoints,
    favoriteInventoryMarks: database.favoriteInventoryMarks,
    favoriteProviderRateCheckpoints: database.favoriteProviderRateCheckpoints,
    favoriteResolutionReceipts: database.favoriteResolutionReceipts,
    favoriteReviewCandidateSets: database.favoriteReviewCandidateSets,
    favoriteResolutionTasks: database.favoriteResolutionTasks,
    favoriteSources: database.favoriteSources,
    libraries: database.libraries,
    organizer: database.organizer,
    progress: database.progress,
    providerIdentityRecovery: database.providerIdentityRecovery,
    reminders: database.reminders,
    reviews: database.reviews,
    works: database.works,
  } satisfies Record<PrivateStoreName, Table>;
  const selected = [...new Set(stores)].map((store) => tables[store]);
  if (stores.includes('works')) selected.push(database.localAgendaProjectionState);
  return selected;
}
