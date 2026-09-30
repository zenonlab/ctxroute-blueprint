import { z } from 'zod';
import { webReviewSnapshotSchema } from '@tobirink/contracts/web-bridge';

const version = 1 as const;
const reviewIdSchema = z.string().regex(/^review_[a-z0-9][a-z0-9_-]{5,}$/u);
const workIdSchema = z.string().regex(/^work_[a-z0-9][a-z0-9_-]{5,}$/u);

export const reviewQueueMessageSchema = z.strictObject({ type: z.literal('review.queue.read'), version: z.literal(version) });
export const reviewCandidatesMessageSchema = z.strictObject({ reviewId: reviewIdSchema, type: z.literal('review.candidates.read'), version: z.literal(version) });
export const reviewDecisionMessageSchema = z.strictObject({
  decision: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('candidate'), workId: workIdSchema }),
    z.strictObject({ kind: z.literal('manual'), source: z.enum(['id', 'url']), value: z.string().trim().min(1).max(500) }),
    z.strictObject({ kind: z.literal('none') }),
  ]),
  reviewId: reviewIdSchema,
  revision: z.string().min(1).max(100),
  type: z.literal('review.decision.write'),
  version: z.literal(version),
});

export const reviewQueueResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), snapshot: z.strictObject({
    items: z.array(z.strictObject({ id: reviewIdSchema, sourceLabel: z.string().min(1), title: z.string().min(1) })).max(100),
    status: z.literal('pending'),
  }) }),
  z.strictObject({ error: z.string(), ok: z.literal(false) }),
]);
export const reviewCandidatesResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), snapshot: z.strictObject({
    reason: z.enum(['AMBIGUOUS', 'NOT_FOUND', 'UNCONFIRMED_SEASON']).optional(),
    providerReferences: webReviewSnapshotSchema.shape.providerReferences,
    matchLevel: z.string().min(1).max(100).optional(),
    provenance: z.string().min(1).max(100).optional(),
    totalCandidates: z.number().int().min(0).max(1000).optional(),
    candidates: z.array(z.strictObject({
      candidateId: workIdSchema,
      coverAlt: z.string().min(1).max(500).optional(),
      coverFallbackSrc: z.url().optional(),
      coverSrc: z.url().optional(),
      href: z.string().regex(/^https?:\/\/[^\s]+$/u),
      mediaType: z.enum(['anime', 'manga']),
      provider: z.string().min(1).max(32),
      providerId: z.string().min(1).max(100),
      title: z.string().min(1).max(300),
    })).max(6),
    reviewId: reviewIdSchema,
    revision: z.string().min(1).max(100),
    state: z.enum(['partial', 'ready']),
    title: z.string().min(1).max(300),
  }) }),
  z.strictObject({ error: z.string(), ok: z.literal(false) }),
]);
export const reviewDecisionResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), status: z.enum(['no-match', 'resolved', 'pending']) }),
  z.strictObject({ error: z.enum(['conflict', 'unavailable']), ok: z.literal(false) }),
]);

export type ReviewQueueResponse = z.infer<typeof reviewQueueResponseSchema>;
export type ReviewCandidatesResponse = z.infer<typeof reviewCandidatesResponseSchema>;

export async function readReviewQueueMessage(): Promise<Extract<ReviewQueueResponse, { ok: true }>['snapshot']> {
  const response = reviewQueueResponseSchema.parse(await browser.runtime.sendMessage({ type: 'review.queue.read', version }));
  if (!response.ok) throw new Error(response.error);
  return response.snapshot;
}

export async function readReviewCandidatesMessage(reviewId: string): Promise<Extract<ReviewCandidatesResponse, { ok: true }>['snapshot']> {
  const response = reviewCandidatesResponseSchema.parse(await browser.runtime.sendMessage({ reviewId, type: 'review.candidates.read', version }));
  if (!response.ok) throw new Error(response.error);
  return response.snapshot;
}

export async function writeReviewDecisionMessage(input: { decision: { kind: 'candidate'; workId: string } | { kind: 'manual'; source: 'id' | 'url'; value: string } | { kind: 'none' }; reviewId: string; revision: string }): Promise<z.infer<typeof reviewDecisionResponseSchema>> {
  return reviewDecisionResponseSchema.parse(await browser.runtime.sendMessage({ ...input, type: 'review.decision.write', version }));
}
