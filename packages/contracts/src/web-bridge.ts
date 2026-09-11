import { z } from 'zod';

const workIdSchema = z.string().regex(/^work_[a-z0-9_]+$/u);
const boundedText = (max: number) => z.string().trim().min(1).max(max);

export const webProtocolVersion = 3 as const;
export const webBridgeMessageLimit = 64 * 1024;
export const webBridgeSessionDurationMs = 60_000;

export const webBootstrapSnapshotSchema = z.object({
  availability: z.enum(['connected', 'extension-missing', 'reconnecting', 'incompatible']),
  generation: z.number().int().nonnegative(),
  libraryCount: z.number().int().nonnegative(),
  pendingReviewCount: z.number().int().nonnegative(),
  protocolVersion: z.literal(webProtocolVersion),
}).strict();

const webFacetStateSchema = z.enum(['include', 'exclude']);
const webFacetSelectionSchema = z.record(boundedText(120), webFacetStateSchema)
  .refine((value) => Object.keys(value).length <= 64, 'A facet selection accepts at most 64 values.');
const webFacetNameSchema = z.enum(['format', 'genre', 'progress', 'source', 'status', 'type', 'year']);
const webLibraryFacetsSchema = z.object({
  format: webFacetSelectionSchema.optional(), genre: webFacetSelectionSchema.optional(), progress: webFacetSelectionSchema.optional(),
  source: webFacetSelectionSchema.optional(), status: webFacetSelectionSchema.optional(), type: webFacetSelectionSchema.optional(), year: webFacetSelectionSchema.optional(),
}).strict();
const webLibrarySortSchema = z.enum(['ADDED_DESC', 'PROGRESS_DESC', 'POPULARITY_DESC', 'TITLE_ASC', 'TITLE_DESC', 'YEAR_DESC']);

export const webLibraryQuerySchema = z.object({
  cursor: boundedText(128).optional(),
  facet: z.enum(['all', 'anime', 'manga']).default('all'),
  facets: webLibraryFacetsSchema.optional(),
  limit: z.number().int().min(1).max(24),
  search: z.string().trim().max(120).optional(),
  sort: webLibrarySortSchema.default('ADDED_DESC'),
  workId: workIdSchema.optional(),
}).strict();

export const webLibraryItemSchema = z.object({
  canonicalUrl: z.string().url().max(2048).optional(),
  chapterCount: z.number().int().nonnegative().optional(),
  coverAttribution: boundedText(120).optional(),
  coverFallbackUrl: z.string().url().max(4096).optional(),
  coverUrl: z.string().url().max(4096).optional(),
  editorialStatus: z.enum(['UPCOMING', 'ONGOING', 'HIATUS', 'COMPLETED', 'CANCELLED', 'UNKNOWN']).optional(),
  endYear: z.number().int().min(1800).max(3000).optional(),
  episodeCount: z.number().int().nonnegative().optional(),
  format: boundedText(120).optional(),
  genres: z.array(boundedText(120)).max(16).optional(),
  mediaKind: z.enum(['anime', 'manga']),
  popularity: z.object({ kind: z.enum(['MEMBERS', 'RANK']), value: z.number().int().nonnegative() }).strict().optional(),
  progress: z.object({ kind: z.enum(['episode', 'chapter', 'volume']), maximum: z.number().nonnegative().optional(), value: z.number().nonnegative() }).strict().optional(),
  progressLabel: boundedText(80).optional(),
  provider: boundedText(120).optional(),
  sourceUrl: z.string().url().max(2048).optional(),
  startYear: z.number().int().min(1800).max(3000).optional(),
  title: boundedText(240),
  titleVariants: z.array(z.object({ language: boundedText(120).optional(), title: boundedText(240) }).strict()).max(16).optional(),
  volumeCount: z.number().int().nonnegative().optional(),
  workId: workIdSchema,
}).strict();

const webFacetOptionsSchema = z.record(webFacetNameSchema, z.array(z.object({ count: z.number().int().nonnegative(), label: boundedText(120), value: boundedText(120) }).strict()).max(64));
const webLibraryStatisticsSchema = z.object({ completed: z.number().int().nonnegative(), inProgress: z.number().int().nonnegative(), knownMetadata: z.number().int().nonnegative(), notStarted: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).strict();

export const webLibraryPageSchema = z.object({
  cursor: boundedText(128).optional(),
  facets: webFacetOptionsSchema,
  hasMore: z.boolean(),
  items: z.array(webLibraryItemSchema).max(24),
  query: webLibraryQuerySchema,
  statistics: webLibraryStatisticsSchema,
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
}).strict();

export const webAgendaPeriodSchema = z.object({
  entries: z.array(z.object({
    availability: z.enum(['official', 'confirmed', 'estimated']),
    kind: z.enum(['anime', 'manga']),
    occursAt: z.string().datetime({ offset: true }),
    releaseLabel: boundedText(240),
    sourceLabel: boundedText(240).optional(),
    sourceUrl: z.string().url().max(2048).optional(),
    title: boundedText(240),
    workId: workIdSchema,
  }).strict()).max(100),
  from: z.string().date(),
  to: z.string().date(),
}).strict();

const webAgendaReadRequestSchema = z.object({
  type: z.literal('agenda.read'),
  requestId: boundedText(128),
  from: z.string().date(),
  to: z.string().date(),
}).strict().superRefine(({ from, to }, context) => {
  const start = new Date(`${from}T00:00:00.000Z`);
  const expectedEnd = new Date(start);
  expectedEnd.setUTCDate(expectedEnd.getUTCDate() + 7);
  if (start.getUTCDay() !== 1 || expectedEnd.toISOString().slice(0, 10) !== to) {
    context.addIssue({ code: 'custom', message: 'Agenda period must be one Monday-to-Monday week.' });
  }
});

export const webReviewSnapshotSchema = z.object({
  reason: z.enum(['AMBIGUOUS', 'NOT_FOUND']).optional(),
  matchLevel: boundedText(100).optional(),
  provenance: boundedText(100).optional(),
  totalCandidates: z.number().int().min(0).max(1000).optional(),
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
    z.object({ kind: z.literal('defer') }).strict(),
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
  webAgendaReadRequestSchema,
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

export const webBridgeSuccessResponseSchema = z.object({
  ok: z.literal(true),
  requestId: boundedText(128),
  type: z.literal('tobirink.webbridge.response'),
  value: z.json(),
}).strict();

export const webPageBridgeResponseSchema = z.object({
  requestId: boundedText(128),
  response: z.union([
    webHandshakeResponseSchema,
    webBridgeSuccessResponseSchema,
    webBridgeErrorResponseSchema,
  ]),
  type: z.literal('tobirink.webbridge.response'),
}).strict();

const webPageBridgeVersionedHandshakeResponseSchema = z.object({
  requestId: boundedText(128),
  response: z.object({
    expiresAt: z.number().int().positive(),
    nonce: boundedText(128),
    ok: z.literal(true),
    protocolVersion: z.number().int().positive(),
    requestId: boundedText(128),
    type: z.literal('tobirink.webbridge.response'),
  }).strict(),
  type: z.literal('tobirink.webbridge.response'),
}).strict();

export const webPageBridgeInboundSchema = z.union([
  webPageBridgeResponseSchema,
  webPageBridgeVersionedHandshakeResponseSchema,
]);

export type WebBootstrapSnapshot = z.infer<typeof webBootstrapSnapshotSchema>;
export type WebLibraryQuery = z.infer<typeof webLibraryQuerySchema>;
export type WebLibraryItem = z.infer<typeof webLibraryItemSchema>;
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
