import type { WorkId } from './identity';
import { canonicalDateTime, invariant, requiredText } from './invariant';
import { createProviderCandidate } from './favorites/contracts';
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
  providerTitleKeys: readonly string[];
}

export function createWork(input: Work): Work {
  const references = input.externalReferences.map((reference) => ({
    externalId: requiredText(reference.externalId, 'externalId'),
    provider: requiredText(reference.provider, 'provider'),
  }));
  const keys = references.map(({ externalId, provider }) => `${provider}\u0000${externalId}`);
  invariant(new Set(keys).size === keys.length, 'duplicate-reference', 'A provider reference may appear only once per work.');

  const work: Work = {
    ...input,
    externalReferences: Object.freeze(references),
    preferredTitle: requiredText(input.preferredTitle, 'preferredTitle'),
  };
  if (input.hydration !== undefined) {
    const hydration = input.hydration;
    invariant(hydration.favoriteAliasKeys.length <= 64 && hydration.providerTitleKeys.length <= 16, 'invalid-favorite-resolution', 'Work identity indexes must be bounded.');
    invariant(references.some((reference) => reference.provider === hydration.candidate.provider && reference.externalId === hydration.candidate.externalId), 'invalid-favorite-resolution', 'Hydrated identity must belong to the work.');
    work.hydration = Object.freeze({
      candidate: createProviderCandidate(hydration.candidate, hydration.candidate.provider),
      favoriteAliasKeys: Object.freeze(hydration.favoriteAliasKeys.map((key) => requiredText(key, 'favoriteAliasKey'))),
      hydratedAt: canonicalDateTime(hydration.hydratedAt, 'hydratedAt'), matcherVersion: requiredText(hydration.matcherVersion, 'matcherVersion'),
      providerTitleKeys: Object.freeze(hydration.providerTitleKeys.map((key) => requiredText(key, 'providerTitleKey'))),
    });
  }
  return Object.freeze(work);
}
