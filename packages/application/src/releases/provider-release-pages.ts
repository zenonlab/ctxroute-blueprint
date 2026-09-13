import { z } from 'zod';
import { publicReleaseEventSchema } from './release-contracts';
import type { PublicReleaseEventContract } from './release-contracts';

const scalarSchema = z.union([z.string().trim().min(1).max(128), z.number().finite()]);
const mangaUpdatesRecordSchema = z.object({ chapter: scalarSchema.optional(), chapter_number: scalarSchema.optional(), id: scalarSchema.optional(), release_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), release_id: scalarSchema.optional(), volume: scalarSchema.optional(), volume_number: scalarSchema.optional() }).passthrough();
const mangaUpdatesSeriesSchema = z.object({ id: scalarSchema.optional(), series_id: scalarSchema.optional() }).passthrough();
export const mangaUpdatesReleaseResultSchema = z.object({ metadata: z.object({ series: mangaUpdatesSeriesSchema.optional() }).passthrough().optional(), record: mangaUpdatesRecordSchema, series: mangaUpdatesSeriesSchema.optional(), series_id: scalarSchema.optional() }).passthrough();
export const mangaUpdatesReleasePageSchema = z.object({ page: z.number().int().positive(), per_page: z.number().int().min(1).max(100), results: z.array(mangaUpdatesReleaseResultSchema).max(100), total_hits: z.number().int().nonnegative() }).passthrough();
export const aniListReleasePageSchema = z.object({ data: z.object({ Page: z.object({ airingSchedules: z.array(z.object({ airingAt: z.number().int().positive(), episode: z.number().int().positive(), media: z.object({ id: z.number().int().positive() }) })).max(50), pageInfo: z.object({ hasNextPage: z.boolean() }) }) }) });

export type AniListReleasePage = z.output<typeof aniListReleasePageSchema>;
export type MangaUpdatesReleasePage = z.output<typeof mangaUpdatesReleasePageSchema>;

function scalar(value: z.infer<typeof scalarSchema> | undefined): string | undefined {
  return value === undefined ? undefined : String(value).trim();
}

export function createMangaUpdatesReleaseEvent(item: z.infer<typeof mangaUpdatesReleaseResultSchema>, fetchedAt: string): PublicReleaseEventContract {
  const seriesId = scalar(item.series_id) ?? scalar(item.series?.series_id) ?? scalar(item.series?.id) ?? scalar(item.metadata?.series?.series_id) ?? scalar(item.metadata?.series?.id);
  if (seriesId === undefined) throw new Error('mangaupdates-series-id-missing');
  const chapter = scalar(item.record.chapter) ?? scalar(item.record.chapter_number);
  const volume = scalar(item.record.volume) ?? scalar(item.record.volume_number);
  const sequence = chapter ?? volume;
  const releaseKind = chapter === undefined ? volume === undefined ? 'special' : 'volume' : 'chapter';
  const providerId = scalar(item.record.id) ?? scalar(item.record.release_id) ?? `${seriesId}-${releaseKind}-${sequence ?? 'none'}-${item.record.release_date}`;
  const releaseAt = Date.parse(`${item.record.release_date}T00:00:00.000Z`);
  return publicReleaseEventSchema.parse({ expiresAt: new Date(releaseAt + 60 * 86_400_000).toISOString(), id: `mangaupdates-${providerId}`.slice(0, 128), occurrence: { kind: 'DATE', value: item.record.release_date }, provenance: { fetchedAt, parserVersion: '2', rulesVersion: '2', source: 'mangaupdates' }, provider: 'mangaupdates', providerWorkId: seriesId, releaseKind, sequence, state: 'CONFIRMED' });
}
