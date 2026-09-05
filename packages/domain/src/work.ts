import type { WorkId } from './identity';
import { invariant, requiredText } from './invariant';

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
}

export function createWork(input: Work): Work {
  const references = input.externalReferences.map((reference) => ({
    externalId: requiredText(reference.externalId, 'externalId'),
    provider: requiredText(reference.provider, 'provider'),
  }));
  const keys = references.map(({ externalId, provider }) => `${provider}\u0000${externalId}`);
  invariant(new Set(keys).size === keys.length, 'duplicate-reference', 'A provider reference may appear only once per work.');

  return Object.freeze({
    ...input,
    externalReferences: Object.freeze(references),
    preferredTitle: requiredText(input.preferredTitle, 'preferredTitle'),
  });
}
