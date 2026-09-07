import type { PageContextPort } from '../ports/capability-ports';
import type { FavoriteSource, Progress, Work } from '@tobirink/domain';
import { createProgress, progressId } from '@tobirink/domain';
import type { StoragePort, StorageSession } from '../ports/storage-port';
import { reconcileProgressObservation } from '../progress/progress-flow';
import { z } from 'zod';

export const popupContinuationLimit = 5;
export const popupContinuationTtlMs = 30 * 24 * 60 * 60 * 1000;
export const popupLocalMatchLimit = 500;

export const popupContinuationRecordSchema = z.strictObject({
  completed: z.boolean().optional(),
  coverAlt: z.string().optional(),
  coverSrc: z.string().optional(),
  id: z.string(),
  indicator: z.string().optional(),
  mediaType: z.string(),
  source: z.string(),
  title: z.string(),
  url: z.string(),
  visitedAt: z.string(),
});

export const popupContinuationCacheEnvelopeSchema = z.strictObject({
  items: z.array(popupContinuationRecordSchema),
  schemaVersion: z.literal(1),
});

export type PopupContinuationRecord = z.infer<typeof popupContinuationRecordSchema>;
export type PopupContinuationCacheEnvelope = z.infer<typeof popupContinuationCacheEnvelopeSchema>;

export interface PopupContinuationCachePort {
  read(): Promise<readonly PopupContinuationRecord[]>;
  write(records: readonly PopupContinuationRecord[]): Promise<void>;
}

export interface PopupContextSnapshot {
  active?: PopupContinuationRecord;
  continuations: readonly PopupContinuationRecord[];
}

export interface ReadPopupContextDependencies {
  cache: PopupContinuationCachePort;
  now: () => string;
  pageContext: PageContextPort;
  storage: StoragePort;
}

export interface PageProgressObservation {
  kind: 'chapter' | 'episode';
  value: number;
}

function isHttpPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function normalise(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('fr')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function titleFromPage(rawTitle: string, url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const siteName = normalise(host.split('.')[0] ?? host);
  const progress = /^(?:chapter|chapitre|ch|episode|épisode|ep|tome|volume)\s*#?\s*\d+[\w.-]*$/iu;
  const parts = rawTitle.split(/\s+(?:[-–—|·])\s+/u).map((part) => part.trim()).filter(Boolean);
  return parts.find((part) => normalise(part) !== siteName && !progress.test(part)) ?? rawTitle.trim();
}

function decodedPageLocation(url: string): string {
  try {
    const parsed = new URL(url);
    const location = `${parsed.pathname} ${parsed.search} ${parsed.hash}`;
    try {
      return decodeURIComponent(location);
    } catch {
      return location;
    }
  } catch {
    return '';
  }
}

export function parsePageProgress(page: { title: string; url: string }): PageProgressObservation | undefined {
  const match = `${page.title} ${decodedPageLocation(page.url)}`.match(/\b(chapter|chapitre|ch|episode|épisode|ep)\b[\s._/#:-]*(\d+(?:[.,]\d+)?)/iu);
  if (!match?.[1] || !match[2]) return undefined;
  const value = Number(match[2].replace(',', '.'));
  if (!Number.isFinite(value) || value < 0 || value > 100_000) return undefined;
  return { kind: /^(?:episode|épisode|ep)$/iu.test(match[1]) ? 'episode' : 'chapter', value };
}

function isFresh(record: PopupContinuationRecord, nowMs: number): boolean {
  const visitedAt = Date.parse(record.visitedAt);
  return !record.completed
    && Number.isFinite(visitedAt)
    && visitedAt <= nowMs
    && nowMs - visitedAt <= popupContinuationTtlMs
    && Boolean(record.id && record.title && record.source && record.mediaType)
    && isHttpPage(record.url);
}

function recordFromPage(page: { title: string; url: string }, visitedAt: string): PopupContinuationRecord | undefined {
  if (!isHttpPage(page.url) || !page.title.trim()) return undefined;
  const parsed = new URL(page.url);
  const title = titleFromPage(page.title.trim(), page.url);
  const id = normalise(title);
  if (!id) return undefined;
  return {
    id,
    indicator: '- / -',
    mediaType: 'Œuvre',
    source: parsed.hostname.replace(/^www\./, ''),
    title,
    url: page.url,
    visitedAt,
  };
}

async function readBoundedFavoriteSources(session: StorageSession): Promise<readonly FavoriteSource[] | undefined> {
  const sources: FavoriteSource[] = [];
  let afterId: FavoriteSource['id'] | undefined;
  while (sources.length <= popupLocalMatchLimit) {
    const limit = Math.min(100, popupLocalMatchLimit + 1 - sources.length);
    const batch = await session.listFavoriteSources(afterId ? { afterId, limit } : { limit });
    if (batch.length === 0) return sources;
    sources.push(...batch);
    if (batch.length < limit) return sources;
    afterId = batch.at(-1)?.id;
  }
  return undefined;
}

interface LocalPageMatch {
  progress?: Progress;
  work: Work;
}

async function matchLocalPage(session: StorageSession, page: { title: string; url: string }): Promise<LocalPageMatch | undefined> {
  const sources = await readBoundedFavoriteSources(session);
  if (!sources) return undefined;
  const titleKey = normalise(titleFromPage(page.title, page.url));
  const matchingSources = sources.filter((source) => source.presence === 'observed' && normalise(titleFromPage(source.title, source.url)) === titleKey);
  const workIds = new Set<Work['id']>();
  for (const source of matchingSources) {
    const review = await session.getReview(source.reviewId);
    if (review?.status === 'resolved' && review.matchedWorkId) workIds.add(review.matchedWorkId);
  }
  if (workIds.size !== 1) return undefined;
  const [matchedWorkId] = workIds;
  if (!matchedWorkId) return undefined;
  const work = await session.getWork(matchedWorkId);
  if (!work) return undefined;
  const progress = await session.findProgressByWorkId(work.id);
  return progress ? { progress, work } : { work };
}

function observedProgress(match: LocalPageMatch, page: { title: string; url: string }): Progress | undefined {
  const observation = parsePageProgress(page);
  const expectedKind = match.work.mediaKind === 'manga' ? 'chapter' : 'episode';
  if (!observation || observation.kind !== expectedKind) return match.progress;
  if (!match.progress) {
    const suffix = match.work.id.replace(/^work_/u, '');
    return createProgress({ id: progressId(`progress_auto_${suffix}`), kind: expectedKind, value: observation.value, workId: match.work.id });
  }
  if (match.progress.kind !== expectedKind) return match.progress;
  if (match.progress.maximum !== undefined && observation.value > match.progress.maximum) return match.progress;
  return reconcileProgressObservation(match.progress, observation.value).explicit;
}

async function enrichActiveRecord(
  storage: StoragePort,
  page: { title: string; url: string },
  record: PopupContinuationRecord,
): Promise<PopupContinuationRecord | undefined> {
  return storage.transaction(['favoriteSources', 'reviews', 'works', 'progress'], async (session) => {
    const match = await matchLocalPage(session, page);
    if (!match) return undefined;
    const progress = observedProgress(match, page);
    if (progress && progress !== match.progress) await session.putProgress(progress);
    const completed = progress?.maximum !== undefined && progress.value >= progress.maximum;
    const enriched = {
      ...record,
      id: match.work.id,
      indicator: progress ? `${progress.value} / ${progress.maximum ?? '-'}` : record.indicator,
      mediaType: match.work.mediaKind === 'manga' ? 'Manga' : 'Anime',
      title: match.work.preferredTitle,
    };
    return completed ? { ...enriched, completed: true } : enriched;
  });
}

export async function readPopupContext({ cache, now, pageContext, storage }: ReadPopupContextDependencies): Promise<PopupContextSnapshot> {
  const currentTime = now();
  const nowMs = Date.parse(currentTime);
  const cached = (await cache.read())
    .filter((record) => Number.isFinite(nowMs) && isFresh(record, nowMs))
    .sort((left, right) => Date.parse(right.visitedAt) - Date.parse(left.visitedAt));
  const page = await pageContext.readActivePage();
  let active = page ? recordFromPage(page, currentTime) : undefined;
  if (active && page) {
    const enriched = await enrichActiveRecord(storage, page, active).catch(() => undefined);
    if (enriched) active = enriched;
  }

  if (!active) {
    const continuations = cached.slice(0, popupContinuationLimit);
    await cache.write(continuations);
    return { continuations };
  }

  const activeTitle = normalise(active.title);
  const continuations = cached
    .filter((record) => record.id !== active.id && normalise(record.title) !== activeTitle)
    .slice(0, popupContinuationLimit - 1);
  await cache.write([active, ...continuations]);
  return { active, continuations };
}
