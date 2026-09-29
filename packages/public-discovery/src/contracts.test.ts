import { describe, expect, it } from 'vitest';
import { publicDiscoveryCandidateSchema, publicDiscoveryLookupSubmissionSchema, publicDiscoveryQuerySchema, publicDiscoveryRefreshSubmissionSchema, publicDiscoverySearchProgressSchema, publicDiscoverySubmissionSchema } from '.';

const query = {
  discoveryTitles: ['One'],
  mediaKind: 'ANIME' as const,
  sourceTitles: ['One'],
};

describe('public discovery request minimization', () => {
  it('accepts bounded selective cursors only for MangaUpdates', () => {
    const base = { candidates: [], cursor: 'mu2:2', provider: 'mangaupdates', titleIndex: 0, version: 1 };
    expect(publicDiscoverySearchProgressSchema.parse(base)).toEqual(base);
    for (const provider of ['anilist', 'mangadex', 'kitsu-anime', 'kitsu-manga']) {
      expect(publicDiscoverySearchProgressSchema.safeParse({ ...base, provider }).success).toBe(false);
    }
    for (const cursor of ['mu2:0', 'mu2:01', 'mu2:100000', 'mu2:-1', 'mu3:2']) {
      expect(publicDiscoverySearchProgressSchema.safeParse({ ...base, cursor }).success).toBe(false);
    }
  });

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

  it('bounds grouped lookups to fifty unique keys', () => {
    const key = { fingerprint: 'a'.repeat(64), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' };
    expect(publicDiscoveryLookupSubmissionSchema.safeParse({ keys: Array.from({ length: 50 }, (_, index) => ({ ...key, fingerprint: index.toString(16).padStart(64, '0') })), schemaVersion: 3 }).success).toBe(true);
    expect(publicDiscoveryLookupSubmissionSchema.safeParse({ keys: Array.from({ length: 51 }, (_, index) => ({ ...key, fingerprint: index.toString(16).padStart(64, '0') })), schemaVersion: 3 }).success).toBe(false);
    expect(publicDiscoveryLookupSubmissionSchema.safeParse({ keys: [key, key], schemaVersion: 3 }).success).toBe(false);
  });

  it('keeps same-work provider references and rejects relation expansion fields', () => {
    const candidate = {
      externalId: '154587', linkedReferences: [{ externalId: '46474', provider: 'kitsu-anime' }],
      mediaKind: 'ANIME', preSerialization: false, provider: 'anilist', titles: ['Shared Title'],
    };
    expect(publicDiscoveryCandidateSchema.parse(candidate).linkedReferences).toEqual(candidate.linkedReferences);
    expect(publicDiscoveryCandidateSchema.safeParse({ ...candidate, relations: [{ relationType: 'ADAPTATION' }] }).success).toBe(false);
  });

  it('reads old search checkpoints and rejects an incomplete anime lane', () => {
    const base = { candidates: [], cursor: '1', provider: 'mangaupdates', titleIndex: 0, version: 1 };
    expect(publicDiscoverySearchProgressSchema.parse(base)).toEqual(base);
    expect(publicDiscoverySearchProgressSchema.parse({ ...base, retryProviders: ['mangadex'] }).retryProviders).toEqual(['mangadex']);
    expect(publicDiscoverySearchProgressSchema.safeParse({ ...base, retryProviders: ['mangadex', 'mangadex'] }).success).toBe(false);
    expect(publicDiscoverySearchProgressSchema.safeParse({ ...base, retryProviders: [] }).success).toBe(false);
    expect(publicDiscoverySearchProgressSchema.safeParse({ ...base, animeLane: { candidates: [], references: [], state: 'MATCH' } }).success).toBe(false);
    expect(publicDiscoverySearchProgressSchema.safeParse({ ...base, animeLane: { candidates: [], references: [], state: 'NOT_FOUND' } }).success).toBe(true);
  });
});
