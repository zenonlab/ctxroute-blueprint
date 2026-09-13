import { publicReleaseEventSchema } from '@tobirink/application';
import type { PublicReleaseEventContract } from '@tobirink/application';
import { z } from 'zod';

const responseByteLimit = 1_000_000;
const jsonSchema = z.json();
const scalarSchema = z.union([z.string().trim().min(1).max(128), z.number().finite()]);
const recordSchema = z.object({ chapter: scalarSchema.optional(), chapter_number: scalarSchema.optional(), id: scalarSchema.optional(), release_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), release_id: scalarSchema.optional(), volume: scalarSchema.optional(), volume_number: scalarSchema.optional() }).passthrough();
const seriesSchema = z.object({ id: scalarSchema.optional(), series_id: scalarSchema.optional() }).passthrough();
const mangaUpdatesResultSchema = z.object({ metadata: z.object({ series: seriesSchema.optional() }).passthrough().optional(), record: recordSchema, series: seriesSchema.optional(), series_id: scalarSchema.optional() }).passthrough();
const mangaUpdatesPageSchema = z.object({ page: z.number().int().positive(), per_page: z.number().int().min(1).max(100), results: z.array(mangaUpdatesResultSchema).max(100), total_hits: z.number().int().nonnegative() }).passthrough();
const aniListPageSchema = z.object({ data: z.object({ Page: z.object({ airingSchedules: z.array(z.object({ airingAt: z.number().int().positive(), episode: z.number().int().positive(), media: z.object({ id: z.number().int().positive() }) })).max(50), pageInfo: z.object({ hasNextPage: z.boolean() }) }) }) });

export type AniListReleasePage = z.output<typeof aniListPageSchema>;
export type MangaUpdatesReleasePage = z.output<typeof mangaUpdatesPageSchema>;

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > responseByteLimit) throw new Error('provider-response-too-large');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > responseByteLimit) throw new Error('provider-response-too-large');
  return text;
}

type ProviderJson = z.output<typeof jsonSchema>;
function parseJson(text: string): ProviderJson {
  try { return jsonSchema.parse(JSON.parse(text)); } catch { throw new Error('provider-json-invalid'); }
}

export async function parseAniListReleasePage(response: Response): Promise<AniListReleasePage> {
  return aniListPageSchema.parse(parseJson(await readBoundedText(response)));
}

export async function parseMangaUpdatesReleasePage(response: Response): Promise<MangaUpdatesReleasePage> {
  return mangaUpdatesPageSchema.parse(parseJson(await readBoundedText(response)));
}

function scalar(value: z.infer<typeof scalarSchema> | undefined): string | undefined {
  return value === undefined ? undefined : String(value).trim();
}

export function createMangaUpdatesReleaseEvent(item: z.infer<typeof mangaUpdatesResultSchema>, fetchedAt: string): PublicReleaseEventContract {
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
