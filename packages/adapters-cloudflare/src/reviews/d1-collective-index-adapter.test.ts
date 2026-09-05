import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./d1-collective-index-adapter.ts', import.meta.url), 'utf8');

describe('D1CollectiveIndexAdapter', () => {
  it('uses ordered bound parameters for every write', () => {
    expect(source).toMatch(/VALUES \(\?1, \?2, \?3, \?4, NULL\)/);
    expect(source).toMatch(/SELECT \?1, \?2, \?3, \?4, \?5, \?6, \?7/);
    expect(source).toMatch(/SET revoked_at = \?3/);
    expect(source).not.toMatch(/\$\{record\.|\$\{consentId|\$\{revokeTokenHash/);
  });

  it('enforces active consent, write credential, replay uniqueness and quota in the insert', () => {
    expect(source).toMatch(/write_token_hash = \?8 AND revoked_at IS NULL/);
    expect(source).toMatch(/consent_id = \?1 AND nonce = \?2/);
    expect(source).toMatch(/COUNT\(\*\)/);
    expect(source).toMatch(/< \?10/);
  });
});
