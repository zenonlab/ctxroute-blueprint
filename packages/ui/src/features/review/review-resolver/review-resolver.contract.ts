export const reviewResolverStates = [
  'ready',
  'loading',
  'empty',
  'partial',
  'offline',
  'error',
  'conflict',
  'success',
] as const;

export type ReviewResolverState = (typeof reviewResolverStates)[number];

export interface ReviewCandidate {
  aliases?: readonly string[];
  candidateId: string;
  coverAlt?: string;
  coverFallbackSrc?: string;
  coverSrc?: string;
  href: string;
  mediaType: string;
  provider: string;
  providerId: string;
  title: string;
}

export interface ReviewItem {
  providerReferences?: readonly { readonly provider: string; readonly externalId: string }[] | undefined;
  reason?: 'AMBIGUOUS' | 'NOT_FOUND' | undefined;
  matchLevel?: string | undefined;
  provenance?: string | undefined;
  totalCandidates?: number | undefined;
  candidates: readonly ReviewCandidate[];
  id: string;
  position?: number;
  progress?: string;
  revision: string;
  sourceLabel: string;
  sourceUrl?: string;
  title: string;
  total?: number;
}

export type ReviewDecision =
  | { candidateId: string; kind: 'candidate'; revision: string }
  | { kind: 'manual'; revision: string; source: 'id' | 'url'; value: string }
  | { kind: 'none'; revision: string };
