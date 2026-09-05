import { describe, expect, it } from 'vitest';
import { contributeCollectiveAssociation, createCollectiveConsent, revokeCollectiveConsent } from './collective-index';
import type { CollectiveAssociationRecord, CollectiveConsentRecord, CollectiveIndexPort } from './collective-index';

class MemoryCollectiveIndex implements CollectiveIndexPort {
  associations: CollectiveAssociationRecord[] = [];
  consent?: CollectiveConsentRecord;
  revoked = false;

  async createConsent(record: CollectiveConsentRecord) { this.consent = record; }
  async recordAssociation(record: CollectiveAssociationRecord) {
    this.associations.push(record);
    return 'accepted' as const;
  }
  async revokeConsent(consentId: string, revokeTokenHash: string) {
    this.revoked = this.consent?.consentId === consentId && this.consent.revokeTokenHash === revokeTokenHash;
    return this.revoked;
  }
}

const credentials = {
  hash: async (secret: string) => `hash:${secret}`,
  issueConsentId: () => 'consent_01990d8e-a9db-7ea8-95d7-0f8f7865a345',
  issueSecret: (() => {
    const secrets = ['revoke-secret', 'write-secret'];
    return () => secrets.shift() ?? 'unused';
  })(),
};

describe('collective index use cases', () => {
  it('stores only credential hashes and returns the one-time secrets', async () => {
    const index = new MemoryCollectiveIndex();
    const result = await createCollectiveConsent({ clock: { now: () => '2026-09-04T10:00:00.000Z' }, credentials, index });
    expect(result).toEqual({
      consentId: 'consent_01990d8e-a9db-7ea8-95d7-0f8f7865a345',
      revokeToken: 'revoke-secret',
      writeToken: 'write-secret',
    });
    expect(index.consent).toMatchObject({ revokeTokenHash: 'hash:revoke-secret', writeTokenHash: 'hash:write-secret' });
  });

  it('hashes the write credential before passing a minimized association', async () => {
    const index = new MemoryCollectiveIndex();
    const input = {
      canonicalWorkId: 'work_frieren',
      consentId: 'consent_01990d8e-a9db-7ea8-95d7-0f8f7865a345',
      decidedAt: '2026-09-04T09:00:00.000Z',
      externalWorkId: '154587',
      nonce: '01990d8e-a9db-7ea8-95d7-0f8f7865a346',
      provider: 'anilist',
      writeToken: 'local-secret',
    };
    await contributeCollectiveAssociation({ clock: { now: () => '2026-09-04T10:00:00.000Z' }, credentials, index }, input, 10);
    expect(index.associations[0]).toEqual({
      canonicalWorkId: input.canonicalWorkId,
      consentId: input.consentId,
      decidedAt: input.decidedAt,
      externalWorkId: input.externalWorkId,
      nonce: input.nonce,
      provider: input.provider,
      receivedAt: '2026-09-04T10:00:00.000Z',
      writeTokenHash: 'hash:local-secret',
    });
  });

  it('hashes the dedicated revoke credential', async () => {
    const index = new MemoryCollectiveIndex();
    index.consent = { consentId: 'consent_test', createdAt: 'now', revokeTokenHash: 'hash:revoke', writeTokenHash: 'hash:write' };
    await expect(revokeCollectiveConsent({ clock: { now: () => 'later' }, credentials, index }, 'consent_test', 'revoke')).resolves.toBe(true);
  });
});
