import { z } from 'zod';

const version = 1 as const;
export const librarySearchMessageSchema = z.strictObject({ query: z.string().trim().min(1).max(200), type: z.literal('library.search.read'), version: z.literal(version) });
export const searchOpenMessageSchema = z.strictObject({ query: z.string().trim().min(1).max(200), type: z.literal('search.open'), version: z.literal(version) });
export const librarySearchResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), snapshot: z.strictObject({
    items: z.array(z.strictObject({
      id: z.string().regex(/^work_[a-z0-9][a-z0-9_-]{5,}$/u),
      mediaType: z.enum(['anime', 'manga']),
      source: z.string().min(1).max(32),
      title: z.string().min(1).max(300),
    })).max(24),
    truncated: z.boolean(),
  }) }),
  z.strictObject({ error: z.string(), ok: z.literal(false) }),
]);
export type LibrarySearchResponse = z.infer<typeof librarySearchResponseSchema>;

export async function readLibrarySearchMessage(query: string): Promise<Extract<LibrarySearchResponse, { ok: true }>['snapshot']> {
  const response = librarySearchResponseSchema.parse(await browser.runtime.sendMessage({ query, type: 'library.search.read', version }));
  if (!response.ok) throw new Error(response.error);
  return response.snapshot;
}

export async function openSearchMessage(query: string): Promise<void> {
  await browser.runtime.sendMessage({ query, type: 'search.open', version });
}
