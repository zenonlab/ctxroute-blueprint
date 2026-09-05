import { describe, expect, it } from 'vitest';
import { extensionMessageSchema, libraryPageResponseSchema, reviewQueueResponseSchema } from './messages';

describe('extension Review messages', () => {
  it('accepts only the exact versioned queue read command', () => {
    expect(extensionMessageSchema.safeParse({ type: 'review.queue.read', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ extra: true, type: 'review.queue.read', version: 1 }).success).toBe(false);
    expect(extensionMessageSchema.safeParse({ type: 'review.queue.read', version: 2 }).success).toBe(false);
  });

  it('bounds and validates the serializable pending snapshot', () => {
    expect(reviewQueueResponseSchema.safeParse({
      ok: true,
      snapshot: { items: [{ id: 'review_source1', sourceLabel: 'https://reader.example/1', title: 'Titre' }], status: 'pending' },
    }).success).toBe(true);
    expect(reviewQueueResponseSchema.safeParse({
      ok: true,
      snapshot: { items: Array.from({ length: 101 }, (_, index) => ({ id: `review_${index}`, sourceLabel: 'source', title: 'Titre' })), status: 'pending' },
    }).success).toBe(false);
    expect(reviewQueueResponseSchema.safeParse({
      ok: true,
      snapshot: { items: [{ id: 'invalid', sourceLabel: '', title: '' }], status: 'pending' },
    }).success).toBe(false);
  });
});

describe('extension Library messages', () => {
  it('validates bounded page commands and serializable responses', () => {
    expect(extensionMessageSchema.safeParse({ type: 'library.page.read', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ afterId: 'work_library-one', type: 'library.page.read', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ afterId: 'invalid', type: 'library.page.read', version: 1 }).success).toBe(false);
    expect(libraryPageResponseSchema.safeParse({
      ok: true,
      snapshot: {
        items: [{ id: 'work_library-one', mediaType: 'manga', source: 'anilist', title: 'Frieren' }],
        missingWorkIds: [],
      },
    }).success).toBe(true);
    expect(libraryPageResponseSchema.safeParse({
      ok: true,
      snapshot: { items: Array.from({ length: 25 }, () => ({ id: 'work_library-one', mediaType: 'manga', source: 'local', title: 'Titre' })), missingWorkIds: [] },
    }).success).toBe(false);
  });
});
