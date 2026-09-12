import { createFavoriteSource, createOrganizerConfiguration, createReview, createWork, favoriteSourceId, reviewId, workId } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';

import { MemoryRecoveryStore } from '../../../../contracts/src/export/memory-recovery-store';
import {
  createEncryptedBackup,
  parseEncryptedBackupBlob,
  restoreEncryptedBackup,
} from './encrypted-backup';

const empty = { agenda: [], favoriteSources: [], libraries: [], progress: [], reminders: [], reviews: [], works: [] };
const privateTitle = 'Titre privé de récupération';
const privateUrl = 'https://reader.example/private-work';
const passphrase = 'phrase secrète locale robuste';
const privateOwnerToken = 'a'.repeat(64);

function sourceStore() {
  const work = createWork({ externalReferences: [], id: workId('work_private'), mediaKind: 'manga', preferredTitle: privateTitle });
  const review = createReview({ id: reviewId('review_private'), matchedWorkId: work.id, sourceLabel: 'reader.example', status: 'resolved', title: privateTitle });
  const source = createFavoriteSource({ bookmarkId: 'bookmark-private', folderPath: ['Privé'], id: favoriteSourceId('source_private'), importedAt: '2026-09-05T09:00:00.000Z', order: 0, reviewId: review.id, title: privateTitle, url: privateUrl });
  const organizer = createOrganizerConfiguration({ folders: [{ conditions: { mediaTypes: ['MANGA'] }, id: 'private-manga', name: 'Manga privé' }], updatedAt: '2026-09-05T09:30:00.000Z' });
  const collectiveOwner = {
    registration: { consent: true as const, installationId: '00000000-0000-4000-8000-000000000002', ownerId: '00000000-0000-4000-8000-000000000001', revokeToken: 'b'.repeat(64), token: privateOwnerToken },
    schemaVersion: 1 as const, sent: {}, status: 'enabled' as const,
  };
  return new MemoryRecoveryStore({ ...empty, collectiveOwner, favoriteSources: [source], organizer, reviews: [review], works: [work] });
}

describe('encrypted cloud recovery', () => {
  it('encrypts the complete private export before producing an uploadable blob', async () => {
    const blob = await createEncryptedBackup(sourceStore(), '2026-09-05T10:00:00.000Z', passphrase);
    expect(blob.serialized).not.toContain(privateTitle);
    expect(blob.serialized).not.toContain(privateUrl);
    expect(blob.serialized).not.toContain(passphrase);
    expect(blob.serialized).not.toContain(privateOwnerToken);
    expect(parseEncryptedBackupBlob(blob)).toMatchObject({ cipher: 'AES-GCM-256', format: 'tobirink-encrypted-backup', version: 1 });
  });

  it('decrypts and validates before one confirmed atomic replacement', async () => {
    const blob = await createEncryptedBackup(sourceStore(), '2026-09-05T10:00:00.000Z', passphrase);
    const target = new MemoryRecoveryStore(empty);
    await restoreEncryptedBackup(blob, passphrase, target, 'replace-private-state');
    expect(target.replaceCount).toBe(1);
    expect((await target.readSnapshot()).works[0]?.preferredTitle).toBe(privateTitle);
    expect((await target.readSnapshot()).favoriteSources[0]?.url).toBe(privateUrl);
    expect((await target.readSnapshot()).organizer?.folders[0]?.id).toBe('private-manga');
    expect((await target.readSnapshot()).collectiveOwner?.registration.token).toBe(privateOwnerToken);
  });

  it('leaves local state untouched for a wrong passphrase or altered ciphertext', async () => {
    const blob = await createEncryptedBackup(sourceStore(), '2026-09-05T10:00:00.000Z', passphrase);
    const wrongPassphraseTarget = new MemoryRecoveryStore(empty);
    await expect(restoreEncryptedBackup(blob, 'une autre phrase secrète', wrongPassphraseTarget, 'replace-private-state')).rejects.toThrow();
    expect(wrongPassphraseTarget.replaceCount).toBe(0);

    const envelope = parseEncryptedBackupBlob(blob);
    const last = envelope.ciphertext.at(-1);
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}${last === 'A' ? 'B' : 'A'}`;
    const altered = { format: blob.format, serialized: JSON.stringify(envelope) };
    const alteredTarget = new MemoryRecoveryStore(empty);
    await expect(restoreEncryptedBackup(altered, passphrase, alteredTarget, 'replace-private-state')).rejects.toThrow();
    expect(alteredTarget.replaceCount).toBe(0);
  });
});
