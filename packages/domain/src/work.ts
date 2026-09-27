import type { WorkId } from './identity';
import { canonicalDateTime, invariant, requiredText } from './invariant';
import { createProviderCandidate, favoriteTitleByteLimit, providerMetadataCollectionLimit, utf8ByteLength } from './favorites/contracts';
import type { ProviderCandidate } from './favorites/contracts';

export type MediaKind = 'anime' | 'manga';

export interface ExternalReference {
  externalId: string;
  provider: string;
}

export interface Work {
  externalReferences: readonly ExternalReference[];
  id: WorkId;
  mediaKind: MediaKind;
  preferredTitle: string;
  hydration?: WorkHydration;
}

export interface WorkHydration {
  candidate: ProviderCandidate;
  favoriteAliasKeys: readonly string[];
  hydratedAt: string;
  matcherVersion: string;
  publicDiscovery?: {
    fingerprint: string;
    mediaKind: 'ANIME' | 'MANGA' | 'MANHWA' | 'MANHUA' | 'UNKNOWN';
    nextRefreshAt: string;
    parserVersion: string;
    siteRulesVersion: string;
    verifiedAt: string;
  };
  providerTitleKeys: readonly string[];
}

function boundedWorkText(value: string, field: string): string {
  const text = requiredText(value, field);
  invariant(utf8ByteLength(text) <= favoriteTitleByteLimit, 'invalid-text', `${field} exceeds ${favoriteTitleByteLimit} UTF-8 bytes.`);
  return text;
}

export function createWork(input: Work): Work {
  const references = input.externalReferences.map((reference) => ({
    externalId: boundedWorkText(reference.externalId, 'externalId'),
    provider: boundedWorkText(reference.provider, 'provider'),
  }));
  const keys = references.map(({ externalId, provider }) => `${provider}\u0000${externalId}`);
  invariant(new Set(keys).size === keys.length, 'duplicate-reference', 'A provider reference may appear only once per work.');

  const work: Work = {
    ...input,
    externalReferences: Object.freeze(references),
    preferredTitle: boundedWorkText(input.preferredTitle, 'preferredTitle'),
  };
  if (input.hydration !== undefined) {
    const hydration = input.hydration;
    invariant(hydration.favoriteAliasKeys.length <= 64 && hydration.providerTitleKeys.length <= providerMetadataCollectionLimit, 'invalid-favorite-resolution', 'Work identity indexes must be bounded.');
    invariant(references.some((reference) => reference.provider === hydration.candidate.provider && reference.externalId === hydration.candidate.externalId), 'invalid-favorite-resolution', 'Hydrated identity must belong to the work.');
    const publicDiscovery = hydration.publicDiscovery === undefined ? undefined : Object.freeze({
      fingerprint: hydration.publicDiscovery.fingerprint,
      mediaKind: hydration.publicDiscovery.mediaKind,
      nextRefreshAt: canonicalDateTime(hydration.publicDiscovery.nextRefreshAt, 'nextRefreshAt'),
      parserVersion: boundedWorkText(hydration.publicDiscovery.parserVersion, 'parserVersion'),
      siteRulesVersion: boundedWorkText(hydration.publicDiscovery.siteRulesVersion, 'siteRulesVersion'),
      verifiedAt: canonicalDateTime(hydration.publicDiscovery.verifiedAt, 'verifiedAt'),
    });
    if (publicDiscovery !== undefined) {
      invariant(/^[a-f0-9]{64}$/u.test(publicDiscovery.fingerprint), 'invalid-favorite-resolution', 'Public discovery fingerprint must be SHA-256.');
      invariant(['ANIME', 'MANGA', 'MANHWA', 'MANHUA', 'UNKNOWN'].includes(publicDiscovery.mediaKind), 'invalid-favorite-resolution', 'Public discovery media kind must be supported.');
      invariant(publicDiscovery.nextRefreshAt > publicDiscovery.verifiedAt, 'invalid-favorite-resolution', 'Public discovery refresh must follow verification.');
    }
    const restored = {
      candidate: createProviderCandidate(hydration.candidate, hydration.candidate.provider),
      favoriteAliasKeys: Object.freeze(hydration.favoriteAliasKeys.map((key) => boundedWorkText(key, 'favoriteAliasKey'))),
      hydratedAt: canonicalDateTime(hydration.hydratedAt, 'hydratedAt'), matcherVersion: boundedWorkText(hydration.matcherVersion, 'matcherVersion'),
      providerTitleKeys: Object.freeze(hydration.providerTitleKeys.map((key) => boundedWorkText(key, 'providerTitleKey'))),
    };
    work.hydration = Object.freeze(publicDiscovery === undefined ? restored : { ...restored, publicDiscovery });
  }
  return Object.freeze(work);
}
