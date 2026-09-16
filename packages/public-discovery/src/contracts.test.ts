import { describe, expect, it } from 'vitest';
import { publicDiscoveryQuerySchema, publicDiscoveryRefreshSubmissionSchema, publicDiscoverySubmissionSchema } from '.';

const query = {
  discoveryTitles: ['One'],
  mediaKind: 'ANIME' as const,
  sourceTitles: ['One'],
};

describe('public discovery request minimization', () => {
  it.each(['discoveryTitles', 'sourceTitles'] as const)('rejects more than four %s', (field) => {
    expect(publicDiscoveryQuerySchema.safeParse({ ...query, [field]: ['One', 'Two', 'Three', 'Four', 'Five'] }).success).toBe(false);
  });

  it('accepts four titles in each bounded list', () => {
    const titles = ['One', 'Two', 'Three', 'Four'];
    expect(publicDiscoveryQuerySchema.safeParse({ ...query, discoveryTitles: titles, sourceTitles: titles }).success).toBe(true);
  });

  it('accepts only the v3 wire schema', () => {
    const key = { fingerprint: 'a'.repeat(64), mediaKind: 'ANIME', parserVersion: '5', siteRulesVersion: '3' };
    expect(publicDiscoverySubmissionSchema.safeParse({ key, query, schemaVersion: 3 }).success).toBe(true);
    expect(publicDiscoverySubmissionSchema.safeParse({ key, query, schemaVersion: 2 }).success).toBe(false);
    expect(publicDiscoveryRefreshSubmissionSchema.safeParse({ key, schemaVersion: 3 }).success).toBe(true);
    expect(publicDiscoveryRefreshSubmissionSchema.safeParse({ key, query, schemaVersion: 3 }).success).toBe(false);
  });
});
