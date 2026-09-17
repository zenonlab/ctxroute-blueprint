import { createProviderCandidate, createProviderCandidateEnvelope } from '@tobirink/domain';
import type { ProviderCandidate, ProviderCandidateEnvelope } from '@tobirink/domain';
import { z } from 'zod';
import type { StoragePort } from '../ports/storage-port';
import { parseFavoriteResolutionTaskPayload } from '../tasks/favorite-resolution-task-payload';
import type { DurableTask } from '../tasks/task-state';
import { inspectFavoriteTitleCandidates } from './provider-matcher';
import type { FavoriteTitleMatchQuery } from './provider-matcher';
import { favoriteProviderPage, favoriteProviderPolicy } from './provider-ports';
import type { FavoriteProviderCandidatePort, FavoriteProviderSearchQuery, ResolutionProvider } from './provider-ports';

const levels = ['source-id', 'source-url', 'ordered-exact', 'explicit-season', 'reordered-significant-words', 'bounded-edit-distance'] as const;
// Discovery endpoints are relevance-ranked searches, not catalogue exports.
// Inspect one bounded result window for at most four independent local aliases;
// exhausting thousands of remote pages cannot strengthen a title proof.
export const favoriteProviderSearchWindow = Object.freeze({ aliases: 4, pagesPerAlias: 1, version: 3 });
const text = z.string().min(1).max(1024);
const count = z.number().int().nonnegative();
type MutableProviderCandidate = { -readonly [Key in keyof ProviderCandidate]: ProviderCandidate[Key] };
type MutableProviderSearchQuery = { -readonly [Key in keyof FavoriteProviderSearchQuery]: FavoriteProviderSearchQuery[Key] };
export const providerCandidateSchema = z.strictObject({
  contentClassification: z.enum(['adult', 'non-adult', 'unknown']).optional(),
  linkedReferences: z.array(z.strictObject({ provider: z.enum(['anilist', 'mangaupdates', 'mangadex', 'kitsu-anime', 'kitsu-manga']), externalId: text })).max(5).optional(),
  canonicalUrl: z.url().max(8192).optional(), categories: z.array(text).max(16).optional(), externalId: text,
  cover: z.strictObject({ attribution: z.string().trim().min(1).max(120), url: z.url().max(32 * 1024) }).optional(),
  displayTitle: text.optional(),
  format: text.optional(), genres: z.array(text).max(16).optional(), mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA']),
  editorialStatus: z.enum(['UPCOMING', 'ONGOING', 'HIATUS', 'COMPLETED', 'CANCELLED', 'UNKNOWN']).optional(),
  startYear: z.number().int().min(1800).max(3000).optional(), endYear: z.number().int().min(1800).max(3000).optional(),
  episodeCount: count.optional(), chapterCount: count.optional(), volumeCount: count.optional(),
  popularity: z.strictObject({ kind: z.enum(['MEMBERS', 'RANK']), value: count }).optional(), metadataVersion: z.union([z.literal(1), z.literal(2)]).optional(),
  preSerialization: z.boolean(), provider: z.enum(['anilist', 'mangaupdates', 'mangadex', 'kitsu-anime', 'kitsu-manga']),
  season: z.number().int().positive().optional(),
  titleVariants: z.array(z.strictObject({ language: z.string().trim().min(1).max(120).optional(), title: text })).max(16).optional(),
  titles: z.array(text).min(1).max(16),
}).transform(({ contentClassification, linkedReferences, canonicalUrl, categories, cover, displayTitle, format, genres, season, titleVariants, editorialStatus, startYear, endYear, episodeCount, chapterCount, volumeCount, popularity, metadataVersion, ...candidate }) => {
  const value: MutableProviderCandidate = candidate;
  if (contentClassification !== undefined) value.contentClassification = contentClassification;
  if (linkedReferences !== undefined) value.linkedReferences = linkedReferences;
  if (canonicalUrl !== undefined) value.canonicalUrl = canonicalUrl;
  if (categories !== undefined) value.categories = categories;
  if (cover !== undefined) value.cover = cover;
  if (displayTitle !== undefined) value.displayTitle = displayTitle;
  if (format !== undefined) value.format = format;
  if (genres !== undefined) value.genres = genres;
  if (season !== undefined) value.season = season;
  if (titleVariants !== undefined) value.titleVariants = titleVariants.map((variant) => variant.language === undefined
    ? { title: variant.title }
    : { language: variant.language, title: variant.title });
  if (editorialStatus !== undefined) value.editorialStatus = editorialStatus;
  if (startYear !== undefined) value.startYear = startYear;
  if (endYear !== undefined) value.endYear = endYear;
  if (episodeCount !== undefined) value.episodeCount = episodeCount;
  if (chapterCount !== undefined) value.chapterCount = chapterCount;
  if (volumeCount !== undefined) value.volumeCount = volumeCount;
  if (popularity !== undefined) value.popularity = popularity;
  if (metadataVersion !== undefined) value.metadataVersion = metadataVersion;
  return createProviderCandidate(value, value.provider);
});
export const favoriteSearchCheckpointSchema = z.strictObject({
  purpose: z.enum(['resolution', 'metadata']).optional(), queryDigest: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  candidates: z.array(providerCandidateSchema).max(20), complete: z.boolean(), cursor: z.string().min(1).max(20).optional(),
  digest: z.string().min(1).max(128), level: z.enum(levels), pages: z.number().int().min(0).max(1000),
  provider: z.enum(['anilist', 'mangaupdates', 'mangadex', 'kitsu-anime', 'kitsu-manga']),
  startedAt: z.number().int().nonnegative(), titleIndex: z.number().int().min(0).max(15), version: z.literal(1),
});
export type FavoriteSearchCheckpoint = z.infer<typeof favoriteSearchCheckpointSchema>;
export interface FavoriteSearchCheckpointPort {
  now(): number;
  read(provider: ResolutionProvider): Promise<FavoriteSearchCheckpoint | undefined>;
  save(checkpoint: FavoriteSearchCheckpoint): Promise<void>;
}
export type FavoriteProviderSearchStep = { readonly kind: 'PAGE_PENDING' } | { readonly kind: 'ENVELOPE'; readonly envelope: ProviderCandidateEnvelope };

function candidateKey(candidate: ProviderCandidate): string { return `${candidate.provider}:${candidate.externalId}`; }

export async function searchFavoriteProviderPage(
  port: FavoriteProviderCandidatePort, query: FavoriteTitleMatchQuery, provider: ResolutionProvider, limit: number,
  checkpoints?: FavoriteSearchCheckpointPort,
): Promise<FavoriteProviderSearchStep> {
  const boundedTitles = (query.discoveryTitles ?? query.sourceTitles).slice(0, favoriteProviderSearchWindow.aliases);
  const base: MutableProviderSearchQuery = { limit, provider, titles: boundedTitles };
  if (query.explicitProviderReference?.provider === provider) base.explicitProviderReference = query.explicitProviderReference;
  if (checkpoints === undefined) return { kind: 'ENVELOPE', envelope: await port.search(base) };
  const stored = await checkpoints.read(provider);
  const queryBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([favoriteProviderSearchWindow.version, { ...query, discoveryTitles: boundedTitles }])));
  const queryDigest = [...new Uint8Array(queryBytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  const age = stored === undefined ? -1 : checkpoints.now() - stored.startedAt;
  const previous = stored !== undefined && stored.queryDigest === queryDigest && age >= 0 && age <= favoriteProviderPolicy.positiveTtlMs ? stored : undefined;
  if (previous?.complete) return { kind: 'ENVELOPE', envelope: createProviderCandidateEnvelope({ candidates: previous.candidates, complete: true, digest: previous.digest, provider, truncated: false }) };
  const titleIndex = previous?.titleIndex ?? 0;
  const title = boundedTitles[titleIndex];
  if (title === undefined) throw new Error('STALE_SEARCH_CHECKPOINT');
  const search = { ...base, titles: [title] };
  const page = await port.search(previous?.cursor === undefined ? search : { ...search, cursor: previous.cursor });
  if (page.provider !== provider || page.candidates.length > limit || (page.complete && (page.truncated || page.nextCursor !== undefined))) throw new Error('INVALID_PROVIDER_PAGE');
  if (!page.complete && page.nextCursor === undefined) return { kind: 'ENVELOPE', envelope: page };
  if (page.nextCursor !== undefined && favoriteProviderPage(page.nextCursor) <= favoriteProviderPage(previous?.cursor)) throw new Error('PROVIDER_CURSOR_DID_NOT_ADVANCE');
  const evidence = inspectFavoriteTitleCandidates(query, page.candidates);
  const nextLevel = levels.indexOf(evidence.level);
  const previousLevel = levels.indexOf(previous?.level ?? 'bounded-edit-distance');
  const selected = new Map<string, ProviderCandidate>();
  if (previous !== undefined && previousLevel <= nextLevel) for (const value of previous.candidates) selected.set(candidateKey(value), value);
  if (nextLevel <= previousLevel) {
    const references = new Set(evidence.candidateReferences.map((reference) => `${reference.provider}:${reference.externalId}`));
    for (const value of page.candidates) if (references.has(candidateKey(value))) selected.set(candidateKey(value), value);
  }
  const candidates = [...selected.values()].sort((left, right) => candidateKey(left).localeCompare(candidateKey(right))).slice(0, limit);
  const completedTitle = true;
  const strongEvidence = nextLevel >= 0 && nextLevel <= levels.indexOf('explicit-season') && evidence.candidateReferences.length > 0;
  const complete = strongEvidence || titleIndex === boundedTitles.length - 1;
  const digestBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([previous?.digest ?? '', page.digest, candidates])));
  const digest = [...new Uint8Array(digestBytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  const next = {
    candidates, complete, digest, queryDigest, level: levels[Math.min(nextLevel, previousLevel)], pages: (previous?.pages ?? 0) + 1,
    provider, startedAt: previous?.startedAt ?? checkpoints.now(), titleIndex: completedTitle && !complete ? titleIndex + 1 : titleIndex, version: 1,
  };
  const checkpoint = favoriteSearchCheckpointSchema.parse(next);
  await checkpoints.save(checkpoint);
  return complete ? { kind: 'ENVELOPE', envelope: createProviderCandidateEnvelope({ candidates, complete: true, digest, provider, truncated: false }) } : { kind: 'PAGE_PENDING' };
}

export function createFavoriteSearchCheckpointPort(storage: StoragePort, task: DurableTask, token: string, now: () => string, purpose: 'resolution' | 'metadata' = 'resolution'): FavoriteSearchCheckpointPort {
  const payload = parseFavoriteResolutionTaskPayload(task.payload);
  let writes: Promise<void> = Promise.resolve();
  return {
    now: () => new Date(now()).valueOf(),
    async read(provider) {
      const record = await storage.getFavoriteParseArtifact(payload.sourceId);
      if (record?.artifact.semanticFingerprint !== payload.semanticFingerprint) throw new Error('STALE_PRIVATE_REFERENCE');
      const checkpoint = record.searchCheckpoints?.find((item) => item.provider === provider && (item.purpose ?? 'resolution') === purpose);
      return checkpoint === undefined ? undefined : favoriteSearchCheckpointSchema.parse(checkpoint);
    },
    save(checkpoint) {
      writes = writes.then(() => storage.transaction(['favoriteArtifacts', 'favoriteResolutionTasks'], async (session) => {
        const record = await session.getFavoriteParseArtifact(payload.sourceId);
        const current = await session.getFavoriteResolutionTask(task.id);
        if (record?.artifact.semanticFingerprint !== payload.semanticFingerprint || current?.claimToken !== token || current.state !== 'CLAIMED'
          || current.idempotencyKey !== task.idempotencyKey || current.claimExpiresAt === undefined || current.claimExpiresAt <= now()) throw new Error('STALE_PRIVATE_REFERENCE');
        const searchCheckpoints = [...(record.searchCheckpoints ?? []).filter((item) => item.provider !== checkpoint.provider || (item.purpose ?? 'resolution') !== purpose), { ...checkpoint, purpose }];
        await session.putFavoriteParseArtifact({ ...record, searchCheckpoints });
      }));
      return writes;
    },
  };
}
