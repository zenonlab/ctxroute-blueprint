import Dexie from 'dexie';
import before from './fixtures/v1-before.json';
import after from './fixtures/v2-after.json';
import versionThree from './fixtures/v3-after.json';
import { TobirinkDatabase, verifyDatabaseIntegrity } from '../src';

async function deleteDatabase(name: string): Promise<void> {
  await Dexie.delete(name);
}

async function seedVersion1(name: string): Promise<void> {
  const database = new Dexie(name);
  database.version(1).stores({
    agenda: '&id, workId, occursAt, availability', libraries: '&id', progress: '&id, workId, kind',
    reminders: '&id, agendaEntryId, channel', reviews: '&id, status', works: '&id, mediaKind, title',
  });
  await database.table('works').bulkAdd(before.works);
  database.close();
}

async function seedVersion2(name: string): Promise<void> {
  const database = new Dexie(name);
  database.version(2).stores({
    agenda: '&id, workId, occursAt, availability', libraries: '&id', progress: '&id, workId, kind',
    reminders: '&id, agendaEntryId, channel', reviews: '&id, status', works: '&id, mediaKind, preferredTitle',
  });
  await database.table('works').bulkAdd(after.works);
  database.close();
}

async function verifySuccessfulMigration(name: string, seed: (databaseName: string) => Promise<void>): Promise<void> {
  await seed(name);
  const database = new TobirinkDatabase(name);
  const migrated = await database.works.toArray();
  const sources = await database.favoriteSources.toArray();
  if (JSON.stringify(migrated) !== JSON.stringify(versionThree.works)) throw new Error('Legacy fixture did not migrate to the version 3 work fixture.');
  if (JSON.stringify(sources) !== JSON.stringify(versionThree.favoriteSources)) throw new Error('Version 3 favorite source store must start empty.');
  const report = await verifyDatabaseIntegrity(database);
  if (report.schemaVersion !== 3 || report.checkedRecords !== 1) throw new Error('Integrity report did not cover the migrated database.');
  database.close();
}

async function verifyInterruptedMigration(name: string): Promise<void> {
  await seedVersion1(name);
  const interrupted = new Dexie(name);
  interrupted.version(1).stores({ works: '&id, mediaKind, title' });
  interrupted.version(2).stores({ works: '&id, mediaKind, preferredTitle' }).upgrade(async (transaction) => {
    await transaction.table('works').toCollection().modify({ preferredTitle: 'partial' });
    throw new Error('simulated interruption');
  });
  try {
    await interrupted.open();
    throw new Error('Interrupted migration unexpectedly succeeded.');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('simulated interruption')) throw error;
  } finally {
    interrupted.close();
  }
  const original = new Dexie(name);
  original.version(1).stores({ works: '&id, mediaKind, title' });
  const records = await original.table('works').toArray();
  original.close();
  if (JSON.stringify(records) !== JSON.stringify(before.works)) throw new Error('Interrupted migration published partial state.');
}

const versionOneName = `tobirink-migration-v1-${Date.now()}`;
const versionTwoName = `tobirink-migration-v2-${Date.now()}`;
const interruptedName = `tobirink-migration-interrupted-${Date.now()}`;
try {
  await verifySuccessfulMigration(versionOneName, seedVersion1);
  await verifySuccessfulMigration(versionTwoName, seedVersion2);
  await verifyInterruptedMigration(interruptedName);
  document.body.dataset.status = 'passed';
  document.body.textContent = 'IndexedDB migrations passed';
} catch (error) {
  document.body.dataset.status = 'failed';
  document.body.textContent = error instanceof Error ? error.message : String(error);
} finally {
  await deleteDatabase(versionOneName);
  await deleteDatabase(versionTwoName);
  await deleteDatabase(interruptedName);
}
