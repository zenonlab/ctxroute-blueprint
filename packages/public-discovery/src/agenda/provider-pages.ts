import { z } from 'zod';
import { publicAgendaReleaseEventSchema, type PublicAgendaReleaseEvent } from './contracts';

const responseByteLimit = 1_000_000;
const jsonSchema = z.json();
type ProviderJson = z.output<typeof jsonSchema>;
const scalarSchema = z.union([z.string().trim().min(1).max(128), z.number().finite()]);
const nullableScalarSchema = scalarSchema.nullable().optional();
const mangaUpdatesRecordSchema = z.object({ chapter: nullableScalarSchema, chapter_number: nullableScalarSchema, id: nullableScalarSchema, release_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u), release_id: nullableScalarSchema, volume: nullableScalarSchema, volume_number: nullableScalarSchema }).passthrough();
const mangaUpdatesSeriesSchema = z.object({ id: nullableScalarSchema, series_id: nullableScalarSchema }).passthrough();
export const mangaUpdatesAgendaResultSchema = z.object({ metadata: z.object({ series: mangaUpdatesSeriesSchema.nullable().optional() }).passthrough().nullable().optional(), record: mangaUpdatesRecordSchema, series: mangaUpdatesSeriesSchema.nullable().optional(), series_id: nullableScalarSchema }).passthrough();
export const mangaUpdatesAgendaPageSchema = z.object({ page: z.number().int().positive(), per_page: z.number().int().min(1).max(100), results: z.array(mangaUpdatesAgendaResultSchema).max(100), total_hits: z.number().int().nonnegative() }).passthrough();
export const aniListAgendaPageSchema = z.object({ data: z.object({ Page: z.object({ airingSchedules: z.array(z.object({ airingAt: z.number().int().positive(), episode: z.number().int().positive(), media: z.object({ id: z.number().int().positive(), status: z.enum(['FINISHED', 'RELEASING', 'NOT_YET_RELEASED', 'CANCELLED', 'HIATUS']).nullish() }) })).max(50), pageInfo: z.object({ hasNextPage: z.boolean() }) }) }) });

async function readBoundedText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > responseByteLimit) throw new Error('provider-response-too-large');
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > responseByteLimit) throw new Error('provider-response-too-large');
  return text;
}

async function parseBoundedJson(response: Response): Promise<ProviderJson> {
  try { return jsonSchema.parse(JSON.parse(await readBoundedText(response))); }
  catch (error) { if (error instanceof Error && error.message === 'provider-response-too-large') throw error; throw new Error('provider-json-invalid'); }
}

export async function parseAniListAgendaPage(response: Response): Promise<z.output<typeof aniListAgendaPageSchema>> { return aniListAgendaPageSchema.parse(await parseBoundedJson(response)); }
export async function parseMangaUpdatesAgendaPage(response: Response): Promise<z.output<typeof mangaUpdatesAgendaPageSchema>> { return mangaUpdatesAgendaPageSchema.parse(await parseBoundedJson(response)); }

function scalar(value: z.infer<typeof scalarSchema> | null | undefined): string | undefined { return value === undefined || value === null ? undefined : String(value).trim(); }

export function createMangaUpdatesAgendaEvent(item: z.infer<typeof mangaUpdatesAgendaResultSchema>, fetchedAt: string): PublicAgendaReleaseEvent {
  const seriesId = scalar(item.series_id) ?? scalar(item.series?.series_id) ?? scalar(item.series?.id) ?? scalar(item.metadata?.series?.series_id) ?? scalar(item.metadata?.series?.id);
  if (seriesId === undefined) throw new Error('mangaupdates-series-id-missing');
  const chapter = scalar(item.record.chapter) ?? scalar(item.record.chapter_number);
  const volume = scalar(item.record.volume) ?? scalar(item.record.volume_number);
  const sequence = chapter ?? volume;
  const releaseKind = chapter === undefined ? volume === undefined ? 'special' : 'volume' : 'chapter';
  const providerId = scalar(item.record.id) ?? scalar(item.record.release_id) ?? `${seriesId}-${releaseKind}-${sequence ?? 'none'}-${item.record.release_date}`;
  const releaseAt = Date.parse(`${item.record.release_date}T00:00:00.000Z`);
  return publicAgendaReleaseEventSchema.parse({ expiresAt: new Date(releaseAt + 60 * 86_400_000).toISOString(), id: `mangaupdates-${providerId}`.slice(0, 128), occurrence: { kind: 'DATE', value: item.record.release_date }, provenance: { fetchedAt, parserVersion: '2', rulesVersion: '2', source: 'mangaupdates' }, provider: 'mangaupdates', providerWorkId: seriesId, releaseKind, sequence, state: 'CONFIRMED' });
}
