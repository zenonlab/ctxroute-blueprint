import { z } from 'zod';

const version = 1 as const;
const passphraseSchema = z.string().min(12).max(1024);
const serializedBackupSchema = z.string().min(64).max(18 * 1024 * 1024);

export const privateRecoveryMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ passphrase: passphraseSchema, type: z.literal('recovery.backup.export'), version: z.literal(version) }),
  z.strictObject({ confirmation: z.literal('replace-private-state'), passphrase: passphraseSchema, serialized: serializedBackupSchema, type: z.literal('recovery.backup.restore'), version: z.literal(version) }),
]);

export const privateRecoveryResponseSchema = z.union([
  z.strictObject({ filename: z.string().min(1).max(128), ok: z.literal(true), serialized: serializedBackupSchema, status: z.literal('exported') }),
  z.strictObject({ ok: z.literal(true), status: z.literal('restored') }),
  z.strictObject({ error: z.string().min(1).max(100), ok: z.literal(false) }),
]);

export async function exportPrivateBackupMessage(passphrase: string) {
  const response = privateRecoveryResponseSchema.parse(await browser.runtime.sendMessage(privateRecoveryMessageSchema.parse({ passphrase, type: 'recovery.backup.export', version })));
  if (!response.ok || response.status !== 'exported') throw new Error(response.ok ? 'unexpected-recovery-response' : response.error);
  return response;
}

export async function restorePrivateBackupMessage(serialized: string, passphrase: string): Promise<void> {
  const response = privateRecoveryResponseSchema.parse(await browser.runtime.sendMessage(privateRecoveryMessageSchema.parse({ confirmation: 'replace-private-state', passphrase, serialized, type: 'recovery.backup.restore', version })));
  if (!response.ok || response.status !== 'restored') throw new Error(response.ok ? 'unexpected-recovery-response' : response.error);
}
