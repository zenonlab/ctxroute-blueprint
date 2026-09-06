import { organizerBookmarkSnapshotSchema } from '@tobirink/application';
import type { OrganizerBookmarkSnapshot, OrganizerSnapshotStorePort } from '@tobirink/application';
import Dexie from 'dexie';
import type { Table } from 'dexie';

interface StoredOrganizerSnapshot extends OrganizerBookmarkSnapshot { id: 'latest' }

class OrganizerSnapshotDatabase extends Dexie {
  readonly snapshots!: Table<StoredOrganizerSnapshot, 'latest'>;
  constructor(name: string) { super(name); this.version(1).stores({ snapshots: '&id' }); }
}

export class DexieOrganizerSnapshotStore implements OrganizerSnapshotStorePort {
  private readonly database: OrganizerSnapshotDatabase;
  constructor(name = 'tobirink-organizer-snapshots') { this.database = new OrganizerSnapshotDatabase(name); }
  async load(): Promise<OrganizerBookmarkSnapshot | undefined> {
    const value = await this.database.snapshots.get('latest');
    if (!value) return undefined;
    const { id: _id, ...snapshot } = value;
    return organizerBookmarkSnapshotSchema.parse(snapshot);
  }
  async save(snapshot: OrganizerBookmarkSnapshot): Promise<void> {
    await this.database.snapshots.put({ ...organizerBookmarkSnapshotSchema.parse(snapshot), id: 'latest' });
  }
  close() { this.database.close(); }
}
