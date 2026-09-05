import type { FavoriteSource, Review, Work } from '@tobirink/domain';

export interface ReviewSourceReference {
  externalId: string;
  provider: string;
}

export interface ReviewSourceReferenceParserPort {
  parse(sourceUrl: string): ReviewSourceReference | undefined;
}

export type ReviewCandidateQuery =
  | { kind: 'reference'; limit: number; reference: ReviewSourceReference }
  | { kind: 'title'; limit: number; title: string };

export interface ReviewCandidatePort {
  findCandidates(query: ReviewCandidateQuery): Promise<readonly Work[]>;
}

export interface ReviewRevisionInput {
  review: Review;
  source: FavoriteSource;
}

export interface ReviewRevisionPort {
  createRevision(input: ReviewRevisionInput): Promise<string>;
}
