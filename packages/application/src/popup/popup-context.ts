import type { PageContextPort } from '../ports/capability-ports';
import { z } from 'zod';

export const popupContinuationLimit = 5;
export const popupContinuationTtlMs = 30 * 24 * 60 * 60 * 1000;

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

export async function readPopupContext({ cache, now, pageContext }: ReadPopupContextDependencies): Promise<PopupContextSnapshot> {
  const currentTime = now();
  const nowMs = Date.parse(currentTime);
  const cached = (await cache.read())
    .filter((record) => Number.isFinite(nowMs) && isFresh(record, nowMs))
    .sort((left, right) => Date.parse(right.visitedAt) - Date.parse(left.visitedAt));
  const page = await pageContext.readActivePage();
  const active = page ? recordFromPage(page, currentTime) : undefined;

  if (!active) {
    const continuations = cached.slice(0, popupContinuationLimit);
    await cache.write(continuations);
    return { continuations };
  }

  const continuations = cached.filter((record) => record.id !== active.id).slice(0, popupContinuationLimit - 1);
  await cache.write([active, ...continuations]);
  return { active, continuations };
}
