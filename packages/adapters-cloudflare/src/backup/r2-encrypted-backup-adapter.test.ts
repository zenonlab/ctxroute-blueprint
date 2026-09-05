import { describe, expect, it } from 'vitest';

import type { EncryptedBackupBlob } from '@tobirink/application';
import type { EncryptedBackupObjectStore } from './r2-encrypted-backup-adapter';
import { R2EncryptedBackupAdapter } from './r2-encrypted-backup-adapter';

const locator = 'backup_locator_0123456789abcdef012345';

function encryptedBlob(): EncryptedBackupBlob {
  return {
    format: 'tobirink-encrypted-backup-blob',
    serialized: JSON.stringify({
      cipher: 'AES-GCM-256',
      ciphertext: 'AAAAAAAAAAAAAAAA',
      dataIv: 'AAAAAAAAAAAAAAAA',
      format: 'tobirink-encrypted-backup',
      kdf: { hash: 'SHA-256', iterations: 310_000, name: 'PBKDF2', salt: 'AAAAAAAAAAAAAAAAAAAAAA==' },
      keyEnvelope: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      keyIv: 'AAAAAAAAAAAAAAAA',
      version: 1,
    }),
  };
}

function objectStore() {
  const objects = new Map<string, Uint8Array>();
  const writes: Array<{ key: string; options: Parameters<EncryptedBackupObjectStore['put']>[2] }> = [];
  const store: EncryptedBackupObjectStore = {
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? { key, size: bytes.byteLength, async text() { return new TextDecoder().decode(bytes); } } : null;
    },
    async put(key, value, options) {
      writes.push({ key, options });
      if (objects.has(key)) return null;
      objects.set(key, Uint8Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)));
      return { key };
    },
  };
  return { objects, store, writes };
}

describe('R2EncryptedBackupAdapter', () => {
  it('stores only a validated encrypted envelope under an immutable locator', async () => {
    const fixture = objectStore();
    const result = await new R2EncryptedBackupAdapter(fixture.store).upload(locator, encryptedBlob());
    expect(result.key).toBe(`backups/v1/${locator}.json`);
    expect(fixture.writes[0]?.options).toMatchObject({
      customMetadata: { format: 'tobirink-encrypted-backup', version: '1' },
      httpMetadata: { cacheControl: 'private, no-store', contentType: 'application/json' },
      onlyIf: { etagDoesNotMatch: '*' },
    });
  });

  it('rejects plaintext before object storage is touched', async () => {
    const fixture = objectStore();
    const plaintext = encryptedBlob();
    plaintext.serialized = JSON.stringify({ format: 'tobirink-private-export', works: [] });
    await expect(new R2EncryptedBackupAdapter(fixture.store).upload(locator, plaintext)).rejects.toThrow();
    expect(fixture.writes).toHaveLength(0);
  });

  it('round-trips only the validated encrypted blob and rejects locator reuse', async () => {
    const fixture = objectStore();
    const adapter = new R2EncryptedBackupAdapter(fixture.store);
    const blob = encryptedBlob();
    await adapter.upload(locator, blob);
    expect(await adapter.download(locator)).toEqual(blob);
    await expect(adapter.upload(locator, blob)).rejects.toThrow('already exists');
  });
});
