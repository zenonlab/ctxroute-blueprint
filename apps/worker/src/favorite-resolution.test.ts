import { describe, expect, it } from 'vitest';
import { isReviewableResolutionReason, markFavoriteMatched, markFavoriteUnresolved, reconcileResolvedFavoriteReviews, resolveLocalFavorite } from './favorite-resolution.js';

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
  it('never converts a terminal SQL or network failure into a user review',async()=>{
    const query=async()=>{throw new Error('query must not run')};
    await expect(markFavoriteUnresolved(query,'source:synthetic-work','23505_DUPLICATE_KEY')).resolves.toBe(false);
    await expect(markFavoriteUnresolved(query,'source:synthetic-work','TIMEOUT')).resolves.toBe(false);
    expect(isReviewableResolutionReason('AMBIGUOUS')).toBe(true);
    expect(isReviewableResolutionReason('NO_RESULT')).toBe(true);
  });
  it('never promotes a link covered by a resolved decision',async()=>{
    const calls:string[]=[];
    await markFavoriteMatched(async sql=>{calls.push(sql);return {rows:[]}},'source:synthetic-work');
    expect(calls[0]).toContain("r.status IN ('RESOLVED','NO_MATCH')");
    expect(calls[0]).toContain('r.decision IS NOT NULL');
    expect(calls[0]).toContain('NOT EXISTS');
  });
  it('closes only an undecided stale review when provider metadata is active', async () => {
    const calls: Array<{ sql: string; values?: unknown[] }> = [];
    const query = async (sql: string, values?: unknown[]) => {
      calls.push({ sql, values });
      if (sql.startsWith('WITH eligible AS')) return { rows: [{ userId: 'alice' }] };
      return { rows: [{ count: 0 }] };
    };
    await reconcileResolvedFavoriteReviews(query, 'media-1');
    expect(calls.some(call => call.sql.includes("status='RESOLVED'"))).toBe(true);
    expect(calls[0].sql).toContain('mm.provider=r.provider');
    expect(calls[0].sql).toContain("l.status IN ('matched','accepted','review')");
    expect(calls[0].sql).toContain('merge.source_media_id=l.media_id');
    expect(calls[0].sql.indexOf('UPDATE bookmark_media_link')).toBeLessThan(calls[0].sql.indexOf('UPDATE favorite_review'));
    expect(calls.some(call => call.sql.startsWith('DELETE FROM personal_notification'))).toBe(true);
  });
  it('does not keep title-specific manual exceptions during reconciliation', async () => {
    const calls: string[] = [];
    const query = async (sql: string) => {
      calls.push(sql);
      if (sql.startsWith('WITH eligible AS')) return { rows: [{ userId: 'alice' }] };
      return { rows: [] };
    };
    await reconcileResolvedFavoriteReviews(query, 'media-1');
    expect(calls.some(sql => sql.includes('UPDATE favorite_review'))).toBe(true);
  });
  it.each(['anilist','mangaupdates'])('atomically moves a synthetic %s provisional link before resolving its review',async provider=>{
    const calls:Array<{sql:string;values?:unknown[]}>=[];
    await reconcileResolvedFavoriteReviews(async(sql,values)=>{calls.push({sql,values});return sql.startsWith('WITH eligible AS')?{rows:[{userId:'synthetic-user'}]}:{rows:[{count:0}]};},`canonical-${provider}`);
    const statement=calls[0].sql;
    expect(statement).toContain('media_identity_merge');
    expect(statement).toContain("status='matched'");
    expect(statement).toContain("review.status='PENDING'");
    expect(statement).toContain("review.decision IS NULL");
    expect(statement).not.toMatch(/popularity|favourites|favorites_count/iu);
    expect(calls[0].values).toEqual([`canonical-${provider}`,'automatic-provider-resolution']);
  });
  it('cannot resurrect a removed link while reconciling a retry',async()=>{
    let statement='';
    await reconcileResolvedFavoriteReviews(async(sql)=>{statement ||= sql;return {rows:[]}},'canonical-synthetic');
    expect(statement).toContain("l.status IN ('matched','accepted','review')");
    expect(statement).not.toContain("l.status<>'removed'");
  });
});
