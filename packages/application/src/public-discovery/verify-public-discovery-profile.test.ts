import { createProviderCandidate } from '@tobirink/domain';
import { describe, expect, it } from 'vitest';
import { favoriteIdentityKey } from '../favorites/favorite-identity-lookup';
import { createFavoriteParseArtifact } from '@tobirink/domain';
import { verifiedPublicDiscoveryProfile } from './verify-public-discovery-profile';

const candidate = createProviderCandidate({ externalId: '42', mediaKind: 'ANIME', metadataVersion: 2, provider: 'anilist', titles: ['Synthetic Series'], titleVariants: [{ language: 'en', title: 'Synthetic Series' }], displayTitle: 'Synthetic Series', preSerialization: false }, 'anilist');

describe('verified public discovery profile', () => {
  it('accepts an official title whose versioned fingerprint is exact', async () => {
    const artifact = createFavoriteParseArtifact({ aliases: [], contractVersion: 2, diagnostics: [], displayTitle: 'Synthetic Series', identityKey: 'synthetic series', matcherVersion: '4', mediaKind: 'ANIME', parserVersion: '5', progressionParserVersion: '2', raw: { title: 'Synthetic Series', url: 'https://example.invalid/synthetic' }, seasonEvidence: { evidence: [], source: 'none' }, segments: [], semanticFingerprint: 'x', sourceAdapterVersion: '3', sourceEvidence: { aliases: [], diagnostics: [], key: 'x', mediaKind: 'ANIME', origin: 'https://example.invalid', path: '/synthetic', proofs: ['CATEGORY_PATH'], sourceAdapter: 'test', strategy: 'exact-origin' }, status: 'parsed', transformations: [] });
    const key = await favoriteIdentityKey(artifact);
    await expect(verifiedPublicDiscoveryProfile(key, candidate)).resolves.toMatchObject({ preferredTitle: 'Synthetic Series', references: [{ externalId: '42', provider: 'anilist' }] });
  });

  it('refuses a provider profile that cannot reproduce the requested fingerprint', async () => {
    await expect(verifiedPublicDiscoveryProfile({ fingerprint: 'f'.repeat(64), mediaKind: 'ANIME', parserVersion: '5', siteRulesVersion: '3' }, candidate)).resolves.toBeUndefined();
  });
});
