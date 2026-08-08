import { describe, expect, it, vi } from 'vitest';
import { isParenthesizedAmbiguity, openFavoriteReview } from './favorite-review.js';

describe('favorite reviews', () => {
  it('keeps an exact title and its parenthesized variant', () => {
    expect(isParenthesizedAmbiguity('Existence', [{ id: 1, title: 'Existence' }, { id: 2, title: 'Existence (Wang)' }])).toBe(true);
  });
  it('is idempotent across worker retries and stores complete candidates', async () => {
    const calls: string[] = []; const query = vi.fn(async (sql: string) => { calls.push(sql); if (sql.startsWith('SELECT l.installation')) return { rows: [{ installationId: 'i', bookmarkId: 'b' }] }; if (sql.startsWith('INSERT INTO favorite_review')) return { rows: [{ id: 'review-1' }] }; if (sql.startsWith('INSERT INTO provider_profile')) return { rows: [{ id: 'profile-1' }] }; if (sql.startsWith("SELECT count(")) return { rows: [{ count: 1 }] }; return { rows: [] }; });
    await openFavoriteReview(query, { userId: 'u', title: 'Existence', url: 'https://example.test/existence', provider: 'mangaupdates', candidates: [{ id: 1, title: 'Existence', hitTitle: 'Existence', authors: ['A'] }, { id: 2, title: 'Existence (Wang)', hitTitle: 'Existence' }] });
    expect(calls.filter(sql => sql.startsWith('INSERT INTO favorite_review_candidate') && sql.includes('VALUES')).length).toBe(2);
    expect(calls.filter(sql => sql.startsWith('INSERT INTO personal_notification')).length).toBe(1);
  });
  it('persists AniList string coverImage values on review candidates', async () => {
    const values: unknown[][] = [];
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.startsWith('SELECT l.installation')) return { rows: [{ installationId: 'i', bookmarkId: 'b' }] };
      if (sql.startsWith('INSERT INTO favorite_review(')) return { rows: [{ id: 'review-1' }] };
      if (sql.startsWith('INSERT INTO provider_profile')) { values.push(parameters ?? []); return { rows: [{ id: 'profile-1' }] }; }
      if (sql.startsWith('SELECT count(')) return { rows: [{ count: 1 }] };
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
      if (sql.startsWith('INSERT INTO provider_profile')) { values = parameters ?? []; return { rows: [{ id: 'profile-1' }] }; }
      if (sql.startsWith('SELECT count(')) return { rows: [{ count: 1 }] };
      return { rows: [] };
    });
    await openFavoriteReview(query, { userId: 'u', title: 'Existence', url: 'https://example.test/existence', provider: 'mangaupdates', candidates: [{ id: 1, title: 'Existence', authors: [], startDate: { year: 2020 } }] });
    expect(values[7]).toBe(JSON.stringify({ year: 2020 }));
    expect(values[9]).toBe(JSON.stringify([]));
    expect(values[14]).toContain('"id":1');
  });
  it('content-addresses identical parsed profiles for reuse across pending reviews', async () => {
    const profileValues: unknown[][] = [];
    const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
      if (sql.startsWith('SELECT l.installation')) return { rows: [{ installationId: 'i', bookmarkId: String(parameters?.[4] ?? 'b') }] };
      if (sql.startsWith('INSERT INTO favorite_review(')) return { rows: [{ id: `review-${parameters?.[2]}` }] };
      if (sql.startsWith('INSERT INTO provider_profile')) { profileValues.push(parameters ?? []); return { rows: [{ id: 'shared-profile' }] }; }
      if (sql.startsWith("SELECT count(")) return { rows: [{ count: 2 }] };
      return { rows: [] };
    });
    const candidate = { id: 7, title: 'Same', genres: ['Drama'], coverImage: 'https://img.example/7.jpg' };
    await openFavoriteReview(query, { userId: 'u1', installationId: 'i1', bookmarkId: 'b1', title: 'Same', url: 'https://one.test', provider: 'anilist', candidates: [candidate] });
    await openFavoriteReview(query, { userId: 'u2', installationId: 'i2', bookmarkId: 'b2', title: 'Same', url: 'https://two.test', provider: 'anilist', candidates: [candidate] });
    expect(profileValues[0]?.[2]).toBe(profileValues[1]?.[2]);
    expect(String(profileValues[0]?.[2])).toHaveLength(64);
  });
  it('uses the original Chrome title and removes candidates absent from the refreshed result', async () => {
    const calls: Array<{sql:string;values?:unknown[]}> = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      calls.push({sql,values});
      if (sql.startsWith('SELECT l.installation')) return { rows: [{ installationId: 'i', bookmarkId: 'b', favoriteTitle: 'The Dreaming Man is a Realist - 7' }] };
      if (sql.startsWith('INSERT INTO favorite_review(')) return { rows: [{ id: 'review-1' }] };
      if (sql.startsWith('INSERT INTO provider_profile')) return { rows: [{ id: 'profile-1' }] };
      if (sql.startsWith("SELECT count(")) return { rows: [{ count: 1 }] };
      return { rows: [] };
    });
    await openFavoriteReview(query, { userId:'u', title:'The Dreaming Boy Is a Realist', url:'https://source.test/dreaming-boy', provider:'anilist', candidates:[{id:1,title:'The Dreaming Boy Is a Realist'}] });
    const reviewInsert=calls.find(call=>call.sql.startsWith('INSERT INTO favorite_review('));
    expect(reviewInsert?.values?.[3]).toBe('The Dreaming Man is a Realist');
    expect(calls.find(call=>call.sql.startsWith('DELETE FROM favorite_review_candidate'))?.values).toEqual(['review-1',['1']]);
  });
  it('uses the shared parser for a leading chapter label', async () => {
    let reviewValues: unknown[] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith('SELECT l.installation')) return { rows: [{ installationId:'i', bookmarkId:'b', rawFavoriteTitle:'Chapter 46 (English) - Synthetic Warriors | ComicK', favoriteUrl:'https://example.test/chapter' }] };
      if (sql.startsWith('INSERT INTO favorite_review(')) { reviewValues=values??[]; return {rows:[{id:'r'}]}; }
      if (sql.startsWith('SELECT count(')) return {rows:[{count:1}]};
      return {rows:[]};
    });
    await openFavoriteReview(query,{userId:'u',title:'fallback',url:'https://example.test',provider:'mangaupdates',candidates:[]});
    expect(reviewValues[3]).toBe('Synthetic Warriors');
  });
  it('consumes the persisted v3 artifact without restoring a chapter in the review title', async () => {
    let reviewValues: unknown[] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith('SELECT l.installation')) return { rows: [{ installationId:'i', bookmarkId:'b', rawFavoriteTitle:'Synthetic Harbor Chronicle Chapter 20', favoriteUrl:'https://reader.invalid/series/synthetic-harbor-chronicle/chapter-20', parseArtifact:{parser:'favorite-parser-v3',identity:{title:'Synthetic Harbor Chronicle'},displayTitle:'Synthetic Harbor Chronicle',progression:{kind:'chapter',number:20,raw:'20'}} }] };
      if (sql.startsWith('INSERT INTO favorite_review(')) { reviewValues=values??[]; return {rows:[{id:'r'}]}; }
      if (sql.startsWith('SELECT count(')) return {rows:[{count:1}]};
      return {rows:[]};
    });
    await openFavoriteReview(query,{userId:'u',title:'fallback',url:'https://reader.invalid',provider:'mangaupdates',candidates:[]});
    expect(reviewValues[3]).toBe('Synthetic Harbor Chronicle');
    expect(String(reviewValues[3])).not.toMatch(/chapter|20/iu);
  });
  it('uses season URL evidence to remove a bare trailing episode number in every review', async () => {
    let reviewValues: unknown[] = [];
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.startsWith('SELECT l.installation')) return { rows: [{ installationId:'i', bookmarkId:'b', rawFavoriteTitle:'Synthetic Cleric 9', favoriteUrl:'https://anime.example/catalogue/synthetic-cleric/saison1/vostfr/' }] };
      if (sql.startsWith('INSERT INTO favorite_review(')) { reviewValues=values??[]; return {rows:[{id:'r'}]}; }
      if (sql.startsWith('SELECT count(')) return {rows:[{count:1}]};
      return {rows:[]};
    });
    await openFavoriteReview(query,{userId:'u',title:'fallback',url:'https://example.test',provider:'anilist',candidates:[]});
    expect(reviewValues[3]).toBe('Synthetic Cleric');
  });
});
