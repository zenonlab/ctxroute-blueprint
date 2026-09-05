import type { FavoriteSource, Review, Work } from '@tobirink/domain';
import { z } from 'zod';

export const reviewCandidateWorkSchema = z.strictObject({
  id: z.string().regex(/^work_[a-z0-9][a-z0-9_-]{5,}$/u),
  mediaKind: z.enum(['anime', 'manga']),
  preferredTitle: z.string().trim().min(1).max(300),
  revision: z.number().int().positive(),
});

export const reviewCandidateReferenceResponseSchema = z.strictObject({
  work: reviewCandidateWorkSchema,
});

export const reviewCandidateTitleResponseSchema = z.strictObject({
  items: z.array(reviewCandidateWorkSchema),
});

export type ReviewCandidateWorkRecord = z.infer<typeof reviewCandidateWorkSchema>;

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
