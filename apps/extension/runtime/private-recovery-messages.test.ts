import { describe, expect, it } from 'vitest';
import { privateRecoveryMessageSchema, privateRecoveryResponseSchema } from './private-recovery-messages';

describe('private recovery messages', () => {
  it('bounds secrets and encrypted payloads and requires the replacement literal', () => {
    expect(privateRecoveryMessageSchema.safeParse({ passphrase: 'trop-court', type: 'recovery.backup.export', version: 1 }).success).toBe(false);
    expect(privateRecoveryMessageSchema.safeParse({ confirmation: 'no', passphrase: 'phrase-secrete-solide', serialized: 'x'.repeat(64), type: 'recovery.backup.restore', version: 1 }).success).toBe(false);
    expect(privateRecoveryMessageSchema.safeParse({ confirmation: 'replace-private-state', extra: true, passphrase: 'phrase-secrete-solide', serialized: 'x'.repeat(64), type: 'recovery.backup.restore', version: 1 }).success).toBe(false);
  });

  it('accepts only bounded typed responses', () => {
    expect(privateRecoveryResponseSchema.parse({ filename: 'backup.tobirink', ok: true, serialized: 'x'.repeat(64), status: 'exported' })).toMatchObject({ status: 'exported' });
    expect(privateRecoveryResponseSchema.safeParse({ ok: true, serialized: 'private', status: 'restored' }).success).toBe(false);
  });
});
