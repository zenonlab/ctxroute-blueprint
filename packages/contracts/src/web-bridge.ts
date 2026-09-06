import { z } from 'zod';

const workIdSchema = z.string().regex(/^work_[a-z0-9_]+$/u);
const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const webProtocolVersion = 2 as const;
export const webBridgeMessageLimit = 64 * 1024;
export const webBridgeSessionDurationMs = 60_000;

export const webBootstrapSnapshotSchema = z.object({
  availability: z.enum(['connected', 'extension-missing', 'reconnecting', 'incompatible']),
  generation: z.number().int().nonnegative(),
  libraryCount: z.number().int().nonnegative(),
  pendingReviewCount: z.number().int().nonnegative(),
  protocolVersion: z.literal(webProtocolVersion),
}).strict();

export const webLibraryQuerySchema = z.object({
  cursor: boundedText(128).optional(),
  facet: z.enum(['all', 'anime', 'manga']).default('all'),
  limit: z.number().int().min(1).max(50),
  search: z.string().trim().max(120).optional(),
}).strict();

export const webLibraryItemSchema = z.object({
  coverUrl: z.string().url().max(2048).optional(),
  mediaKind: z.enum(['anime', 'manga']),
  progressLabel: boundedText(80).optional(),
  title: boundedText(240),
  workId: workIdSchema,
}).strict();

export const webLibraryPageSchema = z.object({
  cursor: boundedText(128).optional(),
  hasMore: z.boolean(),
  items: z.array(webLibraryItemSchema).max(50),
  query: webLibraryQuerySchema,
}).strict();

export const webAgendaPeriodSchema = z.object({
  certainty: z.enum(['confirmed', 'estimated', 'unknown']),
  entries: z.array(z.object({
    date: z.string().date().optional(),
    kind: z.enum(['anime', 'manga']),
    title: boundedText(240),
    workId: workIdSchema,
  }).strict()).max(100),
  from: z.string().date(),
  provenance: z.enum(['local', 'public-catalogue', 'mixed']),
  to: z.string().date(),
}).strict();

export const webReviewSnapshotSchema = z.object({
  candidates: z.array(z.object({
    candidateId: boundedText(128),
    mediaKind: z.enum(['anime', 'manga']),
    sourceUrl: z.string().url().max(2048),
    title: boundedText(240),
    workId: workIdSchema.optional(),
  }).strict()).max(50),
  context: z.enum(['local', 'public']),
  reviewId: boundedText(128).optional(),
  revision: boundedText(256).optional(),
  title: boundedText(240).optional(),
}).strict();

export const webReviewDecisionCommandSchema = z.object({
  decision: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('candidate'), workId: workIdSchema }).strict(),
    z.object({ kind: z.literal('manual'), source: z.enum(['id', 'url']), value: boundedText(2048) }).strict(),
    z.object({ kind: z.literal('none') }).strict(),
  ]),
  reviewId: z.string().regex(/^review_[a-z0-9][a-z0-9_-]{5,}$/u),
  revision: boundedText(256),
}).strict();

export const webHandshakeSchema = z.object({
  origin: z.string().url().max(2048),
  protocolVersion: z.literal(webProtocolVersion),
  requestId: boundedText(128),
  type: z.literal('webbridge.handshake'),
}).strict();

export const webRequestSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('bootstrap.read'), requestId: boundedText(128) }).strict(),
  z.object({ type: z.literal('library.read'), requestId: boundedText(128), query: webLibraryQuerySchema }).strict(),
  z.object({ type: z.literal('agenda.read'), requestId: boundedText(128), from: z.string().date(), to: z.string().date() }).strict(),
  z.object({ type: z.literal('review.read'), requestId: boundedText(128) }).strict(),
  z.object({ type: z.literal('review.decision.write'), requestId: boundedText(128), command: webReviewDecisionCommandSchema }).strict(),
]);

const webMessageSchema = z.union([webHandshakeSchema, webRequestSchema]);
export const webRequestEnvelopeSchema = z.object({
  expiresAt: z.number().int().positive(),
  nonce: boundedText(128),
  origin: z.string().url().max(2048),
  protocolVersion: z.literal(webProtocolVersion),
  request: webRequestSchema,
}).strict();

export const webHandshakeResponseSchema = z.object({
  expiresAt: z.number().int().positive(),
  nonce: boundedText(128),
  ok: z.literal(true),
  protocolVersion: z.literal(webProtocolVersion),
  requestId: boundedText(128),
  type: z.literal('tobirink.webbridge.response'),
}).strict();

export const webBridgeErrorResponseSchema = z.object({
  error: boundedText(128),
  ok: z.literal(false),
  requestId: boundedText(128).optional(),
  type: z.literal('tobirink.webbridge.response'),
}).strict();

export type WebBootstrapSnapshot = z.infer<typeof webBootstrapSnapshotSchema>;
export type WebLibraryQuery = z.infer<typeof webLibraryQuerySchema>;
export type WebLibraryPage = z.infer<typeof webLibraryPageSchema>;
export type WebAgendaPeriod = z.infer<typeof webAgendaPeriodSchema>;
export type WebReviewSnapshot = z.infer<typeof webReviewSnapshotSchema>;
export type WebReviewDecisionCommand = z.infer<typeof webReviewDecisionCommandSchema>;
export type WebHandshake = z.infer<typeof webHandshakeSchema>;
export type WebRequest = z.infer<typeof webRequestSchema>;
export type WebMessageInput = z.input<typeof webMessageSchema>;
export type WebRequestEnvelope = z.infer<typeof webRequestEnvelopeSchema>;
export type WebRequestEnvelopeInput = z.input<typeof webRequestEnvelopeSchema>;

export function webBridgeUtf8Size(serialized: string): number {
  return new TextEncoder().encode(serialized).byteLength;
}

export function assertWebBridgeMessageSize(serialized: string): void {
  if (webBridgeUtf8Size(serialized) > webBridgeMessageLimit) throw new Error('webbridge-message-too-large');
}

export function parseWebMessage(input: WebMessageInput): WebHandshake | WebRequest {
  assertWebBridgeMessageSize(JSON.stringify(input));
  return webMessageSchema.parse(input);
}

export function parseWebRequestEnvelope(input: WebRequestEnvelopeInput, expectedOrigin: string, now = Date.now()): WebRequestEnvelope {
  assertWebBridgeMessageSize(JSON.stringify(input));
  const envelope = webRequestEnvelopeSchema.parse(input);
  if (envelope.origin !== expectedOrigin) throw new Error('webbridge-origin-mismatch');
  if (envelope.expiresAt <= now) throw new Error('webbridge-nonce-expired');
  return envelope;
}
