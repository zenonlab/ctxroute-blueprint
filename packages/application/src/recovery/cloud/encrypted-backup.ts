import { z } from 'zod';

import {
  createPrivateExport,
  importPrivateExport,
  validatePrivateExport,
} from '../private-export';
import type { PrivateExportV3, PrivateExportV4, RecoveryStorePort } from '../private-export';

const backupBase64Schema = z.string().min(16).max(16 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/);
const backupIvSchema = z.string().length(16).regex(/^[A-Za-z0-9+/]+={0,2}$/);

export const encryptedBackupEnvelopeSchema = z.strictObject({
  cipher: z.literal('AES-GCM-256'),
  ciphertext: backupBase64Schema,
  dataIv: backupIvSchema,
  format: z.literal('tobirink-encrypted-backup'),
  kdf: z.strictObject({
    hash: z.literal('SHA-256'),
    iterations: z.literal(310_000),
    name: z.literal('PBKDF2'),
    salt: z.string().length(24).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  }),
  keyEnvelope: z.string().length(64).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  keyIv: backupIvSchema,
  version: z.literal(1),
});

export type EncryptedBackupEnvelope = z.infer<typeof encryptedBackupEnvelopeSchema>;

export interface EncryptedBackupBlob {
  format: 'tobirink-encrypted-backup-blob';
  serialized: string;
}

const BACKUP_CONTEXT = new TextEncoder().encode('tobirink-encrypted-backup:v1');

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return crypto.getRandomValues(new Uint8Array(length));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function assertPassphrase(passphrase: string): void {
  if (passphrase.length < 12 || passphrase.length > 1024) {
    throw new RangeError('Backup passphrase must contain between 12 and 1024 characters');
  }
}

async function deriveWrappingKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { hash: 'SHA-256', iterations: 310_000, name: 'PBKDF2', salt },
    material,
    { length: 256, name: 'AES-GCM' },
    false,
    ['decrypt', 'encrypt'],
  );
}

export function parseEncryptedBackupBlob(blob: EncryptedBackupBlob): EncryptedBackupEnvelope {
  if (blob.format !== 'tobirink-encrypted-backup-blob') throw new TypeError('Invalid encrypted backup blob');
  return encryptedBackupEnvelopeSchema.parse(JSON.parse(blob.serialized));
}

export async function encryptPrivateExport(
  privateExport: PrivateExportV3 | PrivateExportV4,
  passphrase: string,
): Promise<EncryptedBackupBlob> {
  assertPassphrase(passphrase);
  const validated = validatePrivateExport(JSON.stringify(privateExport));
  const salt = randomBytes(16);
  const dataIv = randomBytes(12);
  const keyIv = randomBytes(12);
  const wrappingKey = await deriveWrappingKey(passphrase, salt);
  // SAFETY: AES-GCM is a symmetric algorithm, so WebCrypto returns one CryptoKey rather than a CryptoKeyPair.
  const dataKey = await crypto.subtle.generateKey(
    { length: 256, name: 'AES-GCM' },
    true,
    ['decrypt', 'encrypt'],
  ) as CryptoKey;
  const ciphertext = await crypto.subtle.encrypt(
    { additionalData: BACKUP_CONTEXT, iv: dataIv, name: 'AES-GCM' },
    dataKey,
    new TextEncoder().encode(JSON.stringify(validated)),
  );
  // SAFETY: requesting the raw export format for a symmetric AES key returns an ArrayBuffer, never a JWK.
  const rawDataKey = await crypto.subtle.exportKey('raw', dataKey) as ArrayBuffer;
  const keyEnvelope = await crypto.subtle.encrypt(
    { additionalData: BACKUP_CONTEXT, iv: keyIv, name: 'AES-GCM' },
    wrappingKey,
    rawDataKey,
  );
  const envelope: EncryptedBackupEnvelope = {
    cipher: 'AES-GCM-256',
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    dataIv: encodeBase64(dataIv),
    format: 'tobirink-encrypted-backup',
    kdf: { hash: 'SHA-256', iterations: 310_000, name: 'PBKDF2', salt: encodeBase64(salt) },
    keyEnvelope: encodeBase64(new Uint8Array(keyEnvelope)),
    keyIv: encodeBase64(keyIv),
    version: 1,
  };
  return { format: 'tobirink-encrypted-backup-blob', serialized: JSON.stringify(envelope) };
}

export async function decryptPrivateExport(
  blob: EncryptedBackupBlob,
  passphrase: string,
): Promise<PrivateExportV4> {
  assertPassphrase(passphrase);
  const envelope = parseEncryptedBackupBlob(blob);
  const wrappingKey = await deriveWrappingKey(passphrase, decodeBase64(envelope.kdf.salt));
  const rawDataKey = await crypto.subtle.decrypt(
    { additionalData: BACKUP_CONTEXT, iv: decodeBase64(envelope.keyIv), name: 'AES-GCM' },
    wrappingKey,
    decodeBase64(envelope.keyEnvelope),
  );
  const dataKey = await crypto.subtle.importKey('raw', rawDataKey, { name: 'AES-GCM' }, false, ['decrypt']);
  const plaintext = await crypto.subtle.decrypt(
    { additionalData: BACKUP_CONTEXT, iv: decodeBase64(envelope.dataIv), name: 'AES-GCM' },
    dataKey,
    decodeBase64(envelope.ciphertext),
  );
  return validatePrivateExport(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(plaintext));
}

export async function createEncryptedBackup(
  storage: RecoveryStorePort,
  exportedAt: string,
  passphrase: string,
): Promise<EncryptedBackupBlob> {
  return encryptPrivateExport(await createPrivateExport(storage, exportedAt), passphrase);
}

export async function restoreEncryptedBackup(
  blob: EncryptedBackupBlob,
  passphrase: string,
  storage: RecoveryStorePort,
  confirmation: string,
): Promise<void> {
  const privateExport = await decryptPrivateExport(blob, passphrase);
  await importPrivateExport(JSON.stringify(privateExport), storage, confirmation);
}
