import type { PrivateStoreName } from '@tobirink/application';
import type { Table } from 'dexie';
import type { TobirinkDatabase } from './database';

export function privateStoreTables(database: TobirinkDatabase, stores: readonly PrivateStoreName[]): Table[] {
  const tables = {
    agenda: database.agenda,
    favoriteArtifacts: database.favoriteArtifacts,
    favoriteResolutionTasks: database.favoriteResolutionTasks,
    favoriteSources: database.favoriteSources,
    libraries: database.libraries,
    organizer: database.organizer,
    progress: database.progress,
    reminders: database.reminders,
    reviews: database.reviews,
    works: database.works,
  } satisfies Record<PrivateStoreName, Table>;
  return [...new Set(stores)].map((store) => tables[store]);
}
