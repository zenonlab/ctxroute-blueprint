import { parseEncryptedBackupBlob } from '@tobirink/application';
import type { EncryptedBackupBlob } from '@tobirink/application';

interface StoredBackupObject {
  key: string;
}

interface StoredBackupBody extends StoredBackupObject {
  size: number;
  text(): Promise<string>;
}

export interface EncryptedBackupObjectStore {
  get(key: string): Promise<StoredBackupBody | null>;
  put(
    key: string,
    value: ArrayBufferView,
    options: {
      customMetadata: { format: 'tobirink-encrypted-backup'; version: '1' };
      httpMetadata: { cacheControl: 'private, no-store'; contentType: 'application/json' };
      onlyIf: { etagDoesNotMatch: '*' };
      sha256: ArrayBufferView;
    },
  ): Promise<StoredBackupObject | null>;
}

const BACKUP_LOCATOR_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const MAX_BACKUP_BYTES = 17 * 1024 * 1024;

function objectKey(locator: string): string {
  if (!BACKUP_LOCATOR_PATTERN.test(locator)) throw new TypeError('Invalid encrypted backup locator');
  return ['backups', 'v1', `${locator}.json`].join('/');
}

export class R2EncryptedBackupAdapter {
  constructor(private readonly bucket: EncryptedBackupObjectStore) {}

  async upload(locator: string, blob: EncryptedBackupBlob): Promise<{ key: string }> {
    parseEncryptedBackupBlob(blob);
    const bytes = new TextEncoder().encode(blob.serialized);
    if (bytes.byteLength > MAX_BACKUP_BYTES) throw new RangeError('Encrypted backup exceeds the storage limit');
    const checksum = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
    const key = objectKey(locator);
    const stored = await this.bucket.put(key, bytes, {
      customMetadata: { format: 'tobirink-encrypted-backup', version: '1' },
      httpMetadata: { cacheControl: 'private, no-store', contentType: 'application/json' },
      onlyIf: { etagDoesNotMatch: '*' },
      sha256: new Uint8Array(checksum),
    });
    if (!stored) throw new Error('Encrypted backup locator already exists');
    return { key: stored.key };
  }

  async download(locator: string): Promise<EncryptedBackupBlob | undefined> {
    const stored = await this.bucket['get'](objectKey(locator));
    if (!stored) return undefined;
    if (stored.size > MAX_BACKUP_BYTES) throw new RangeError('Encrypted backup exceeds the storage limit');
    const blob: EncryptedBackupBlob = {
      format: 'tobirink-encrypted-backup-blob',
      serialized: await stored.text(),
    };
    parseEncryptedBackupBlob(blob);
    return blob;
  }
}
