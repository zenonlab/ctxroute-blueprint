import { describe, expect, it } from 'vitest';
import { markFavoriteUnresolved, reconcileResolvedFavoriteReviews, resolveLocalFavorite } from './favorite-resolution.js';

describe('favorite resolution lifecycle', () => {
  it('accepts only one exact local canonical alias', async () => {
    const query = async () => ({ rows: [{ mediaId: 'canonical-1', resolved: true, hasProviderId: true }] });
    await expect(resolveLocalFavorite(query, { mediaId: 'source-1', userId: 'alice', type: 'ANIME', aliases: ['frieren'] })).resolves.toMatchObject({ mediaId: 'canonical-1', resolved: true });
  });
  it('keeps review and deduplicates the unresolved notification', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const query = async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return { rows: [] };
    };
    await markFavoriteUnresolved(query, 'source:work', 'NO_RESULT');
    expect(calls[0].sql).toContain("status='review'");
    expect(calls[1].sql).toContain("'FAVORITE_UNRESOLVED'");
    expect(calls[1].sql).toContain('ON CONFLICT(user_id,release_key,kind) DO NOTHING');
    expect(calls[1].values).toEqual(['favorite-unresolved|source:work', 'source:work', 'NO_RESULT']);
  });
  it('closes only an undecided stale review when provider metadata is active', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const query = async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.startsWith('SELECT r.id')) return { rows: [{ id: 'review-1', userId: 'alice', favoriteTitle: 'Known work', provider: 'anilist', externalId: '135806' }] };
      if (sql.startsWith('UPDATE favorite_review')) return { rows: [{ userId: 'alice' }] };
      return { rows: [{ count: 0 }] };
    };
    await reconcileResolvedFavoriteReviews(query, 'media-1');
    expect(calls.some(call => call.sql.includes("status='RESOLVED'"))).toBe(true);
    expect(calls[0].sql).toContain('mm.provider=r.provider');
    expect(calls.some(call => call.sql.startsWith('DELETE FROM personal_notification'))).toBe(true);
  });
  it('does not keep title-specific manual exceptions during reconciliation', async () => {
    const calls: string[] = [];
    const query = async (sql: string) => {
      calls.push(sql);
      if (sql.startsWith('SELECT r.id')) return { rows: [{ id: 'review-1', userId: 'alice', favoriteTitle: 'The Dreaming Man is a Realist - 7', provider: 'anilist', externalId: '1' }] };
      return { rows: [] };
    };
    await reconcileResolvedFavoriteReviews(query, 'media-1');
    expect(calls.some(sql => sql.startsWith('UPDATE favorite_review'))).toBe(true);
  });
});
