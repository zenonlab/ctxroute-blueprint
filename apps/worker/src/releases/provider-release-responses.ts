import { aniListReleasePageSchema, createMangaUpdatesReleaseEvent, mangaUpdatesReleasePageSchema } from '@tobirink/application';
import type { AniListReleasePage, MangaUpdatesReleasePage } from '@tobirink/application';
import { z } from 'zod';

const responseByteLimit = 1_000_000;
const jsonSchema = z.json();
export { createMangaUpdatesReleaseEvent } from '@tobirink/application';

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
  return aniListReleasePageSchema.parse(parseJson(await readBoundedText(response)));
}

export async function parseMangaUpdatesReleasePage(response: Response): Promise<MangaUpdatesReleasePage> {
  return mangaUpdatesReleasePageSchema.parse(parseJson(await readBoundedText(response)));
}
