import type { Transaction } from 'dexie';

interface Version1WorkRecord {
  externalReferences: readonly { externalId: string; provider: string }[];
  id: string;
  mediaKind: 'anime' | 'manga';
  preferredTitle?: string;
  title?: string;
}

export async function migrateVersion1To2(transaction: Transaction): Promise<void> {
  await transaction.table<Version1WorkRecord>('works').toCollection().modify((work) => {
    if (work.preferredTitle === undefined && work.title !== undefined) work.preferredTitle = work.title;
    delete work.title;
  });
}
