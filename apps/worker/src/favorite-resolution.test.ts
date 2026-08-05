import { describe, expect, it } from 'vitest';
import { markFavoriteUnresolved } from './favorite-resolution.js';

describe('favorite resolution lifecycle', () => {
  it('keeps review and deduplicates the unresolved notification', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const query = async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      return {};
    };
    await markFavoriteUnresolved(query, 'source:work', 'NO_RESULT');
    expect(calls[0].sql).toContain("status='review'");
    expect(calls[1].sql).toContain("'FAVORITE_UNRESOLVED'");
    expect(calls[1].sql).toContain('ON CONFLICT(user_id,release_key,kind) DO NOTHING');
    expect(calls[1].values).toEqual(['favorite-unresolved|source:work', 'source:work', 'NO_RESULT']);
  });
});
