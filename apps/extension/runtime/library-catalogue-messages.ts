import { z } from 'zod';

const facetSelectionSchema = z.record(
  z.string().min(1).max(120),
  z.enum(['include', 'exclude']),
).refine((selection) => Object.keys(selection).length <= 64);

const facetsSchema = z.strictObject({
  format: facetSelectionSchema.optional(),
  genre: facetSelectionSchema.optional(),
  progress: facetSelectionSchema.optional(),
  source: facetSelectionSchema.optional(),
  status: facetSelectionSchema.optional(),
  type: facetSelectionSchema.optional(),
  year: facetSelectionSchema.optional(),
});

export const libraryCatalogueMessageSchema = z.strictObject({
  facets: facetsSchema.optional(),
  offset: z.number().int().nonnegative().optional(),
  query: z.string().max(300).optional(),
  sort: z.enum(['ADDED_DESC', 'PROGRESS_DESC', 'POPULARITY_DESC', 'TITLE_ASC', 'TITLE_DESC', 'YEAR_DESC']),
  type: z.literal('library.catalogue.read'),
  version: z.literal(1),
});

const facetOptionSchema = z.strictObject({
  count: z.number().int().nonnegative(),
  label: z.string().min(1).max(200),
  value: z.string().min(1).max(120),
});

export const libraryCatalogueResponseSchema = z.discriminatedUnion('ok', [
  z.strictObject({
    ok: z.literal(true),
    snapshot: z.strictObject({
      facets: z.strictObject({
        format: z.array(facetOptionSchema).max(64),
        genre: z.array(facetOptionSchema).max(64),
        progress: z.array(facetOptionSchema).max(64),
        source: z.array(facetOptionSchema).max(64),
        status: z.array(facetOptionSchema).max(64),
        type: z.array(facetOptionSchema).max(64),
        year: z.array(facetOptionSchema).max(64),
      }),
      items: z.array(z.strictObject({
        coverAlt: z.string().min(1).max(500).optional(),
        coverSrc: z.url().max(4096).optional(),
        coverFallbackSrc: z.url().max(4096).optional(),
        detail: z.string().min(1).max(300).optional(),
        href: z.url().max(8192).optional(),
        id: z.string().regex(/^work_[a-z0-9][a-z0-9_-]{5,}$/u),
        mediaType: z.enum(['anime', 'manga']),
        progress: z.string().min(1).max(60).optional(),
        source: z.string().min(1).max(64),
        title: z.string().min(1).max(300),
      })).max(24),
      nextOffset: z.number().int().positive().optional(),
      statistics: z.strictObject({
        completed: z.number().int().nonnegative(),
        inProgress: z.number().int().nonnegative(),
        knownMetadata: z.number().int().nonnegative(),
        notStarted: z.number().int().nonnegative(),
        total: z.number().int().nonnegative(),
      }),
      total: z.number().int().nonnegative(),
      truncated: z.boolean(),
    }),
  }),
  z.strictObject({ error: z.string(), ok: z.literal(false) }),
]);

export type LibraryCatalogueRequest = z.infer<typeof libraryCatalogueMessageSchema>;
export type LibraryCatalogueResponse = z.infer<typeof libraryCatalogueResponseSchema>;

export async function readLibraryCatalogueMessage(input: Omit<LibraryCatalogueRequest, 'type' | 'version'>): Promise<Extract<LibraryCatalogueResponse, { ok: true }>['snapshot']> {
  const response = libraryCatalogueResponseSchema.parse(await browser.runtime.sendMessage({ ...input, type: 'library.catalogue.read', version: 1 }));
  if (!response.ok) throw new Error(response.error);
  return response.snapshot;
}
