import { describe, expect, it, vi } from 'vitest';
import { isManualOnlyReviewTitle, isParenthesizedAmbiguity, openFavoriteReview } from './favorite-review.js';

describe('favorite reviews', () => {
  it('keeps an exact title and its parenthesized variant', () => {
    expect(isParenthesizedAmbiguity('Existence', [{ id: 1, title: 'Existence' }, { id: 2, title: 'Existence (Wang)' }])).toBe(true);
  });
  it('is idempotent across worker retries and stores complete candidates', async () => {
    const calls: string[] = []; const query = vi.fn(async (sql: string) => { calls.push(sql); if (sql.startsWith('SELECT l.installation')) return { rows: [{ installationId: 'i', bookmarkId: 'b' }] }; if (sql.startsWith('INSERT INTO favorite_review')) return { rows: [{ id: 'review-1' }] }; if (sql.startsWith("SELECT count(*)")) return { rows: [{ count: 1 }] }; return { rows: [] }; });
    await openFavoriteReview(query, { userId: 'u', title: 'Existence', url: 'https://example.test/existence', provider: 'mangaupdates', candidates: [{ id: 1, title: 'Existence', hitTitle: 'Existence', authors: ['A'] }, { id: 2, title: 'Existence (Wang)', hitTitle: 'Existence' }] });
    expect(calls.filter(sql => sql.startsWith('INSERT INTO favorite_review_candidate')).length).toBe(2);
    expect(calls.filter(sql => sql.startsWith('INSERT INTO personal_notification')).length).toBe(1);
  });
  it('persists AniList string coverImage values on review candidates', async () => {
    const values: unknown[][] = [];
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.startsWith('SELECT l.installation')) return { rows: [{ installationId: 'i', bookmarkId: 'b' }] };
      if (sql.startsWith('INSERT INTO favorite_review(')) return { rows: [{ id: 'review-1' }] };
      if (sql.startsWith('INSERT INTO favorite_review_candidate')) { values.push(parameters ?? []); return { rows: [] }; }
      if (sql.startsWith('SELECT count(*)')) return { rows: [{ count: 1 }] };
      return { rows: [] };
    });
    await openFavoriteReview(query, { userId: 'u', title: 'Anime', url: 'https://example.test/anime', provider: 'anilist', candidates: [{ id: 7, title: 'Anime', coverImage: 'https://img.example/7.jpg' }] });
    expect(values[0]?.[12]).toBe('https://img.example/7.jpg');
  });
  it('serializes MangaUpdates JSON fields before binding jsonb columns', async () => {
    let values: unknown[] = [];
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.startsWith('SELECT l.installation')) return { rows: [{ installationId: 'i', bookmarkId: 'b' }] };
      if (sql.startsWith('INSERT INTO favorite_review(')) return { rows: [{ id: 'review-1' }] };
      if (sql.startsWith('INSERT INTO favorite_review_candidate')) { values = parameters ?? []; return { rows: [] }; }
      if (sql.startsWith('SELECT count(*)')) return { rows: [{ count: 1 }] };
      return { rows: [] };
    });
    await openFavoriteReview(query, { userId: 'u', title: 'Existence', url: 'https://example.test/existence', provider: 'mangaupdates', candidates: [{ id: 1, title: 'Existence', authors: [], startDate: { year: 2020 } }] });
    expect(values[7]).toBe(JSON.stringify({ year: 2020 }));
    expect(values[9]).toBe(JSON.stringify([]));
    expect(values[14]).toContain('"id":1');
  });
  it('marks the known manual-only titles as non-automatic reviews', () => {
    expect(isManualOnlyReviewTitle('The Dreaming Man')).toBe(true);
    expect(isManualOnlyReviewTitle('The Dreaming Man is a Realist')).toBe(true);
    expect(isManualOnlyReviewTitle('The Dreaming Man is a Realist - 7')).toBe(true);
    expect(isManualOnlyReviewTitle('Happy Mariage 8')).toBe(true);
    expect(isManualOnlyReviewTitle('Moi, le maître des interdits2')).toBe(true);
    expect(isManualOnlyReviewTitle('The Dreaming Boy Is a Realist')).toBe(false);
  });
});
