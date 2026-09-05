import { describe, expect, it } from 'vitest';
import { collectiveAssociationSchema, createCollectiveConsentSchema } from './collective-index-contract';

const association = {
  canonicalWorkId: 'work_frieren',
  consentId: 'consent_01990d8e-a9db-7ea8-95d7-0f8f7865a345',
  decidedAt: '2026-09-04T10:00:00.000Z',
  externalWorkId: 'anilist:154587',
  nonce: '01990d8e-a9db-7ea8-95d7-0f8f7865a346',
  provider: 'anilist',
};

describe('collective index HTTP contracts', () => {
  it('accepts only explicit consent', () => {
    expect(createCollectiveConsentSchema.safeParse({ consent: true }).success).toBe(true);
    expect(createCollectiveConsentSchema.safeParse({ consent: false }).success).toBe(false);
    expect(createCollectiveConsentSchema.safeParse({ consent: true, implicit: true }).success).toBe(false);
  });

  it('accepts only public identifiers and rejects private browsing fields', () => {
    expect(collectiveAssociationSchema.safeParse(association).success).toBe(true);
    for (const privateField of ['title', 'url', 'library', 'progress']) {
      expect(collectiveAssociationSchema.safeParse({ ...association, [privateField]: 'private' }).success).toBe(false);
    }
  });

  it('rejects malformed identifiers, providers, nonces and dates', () => {
    expect(collectiveAssociationSchema.safeParse({ ...association, canonicalWorkId: 'Frieren' }).success).toBe(false);
    expect(collectiveAssociationSchema.safeParse({ ...association, externalWorkId: 'raw title with spaces' }).success).toBe(false);
    expect(collectiveAssociationSchema.safeParse({ ...association, nonce: 'again' }).success).toBe(false);
    expect(collectiveAssociationSchema.safeParse({ ...association, decidedAt: 'today' }).success).toBe(false);
  });
});
