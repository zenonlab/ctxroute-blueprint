import { applyD1Migrations, env, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(async () => {
  await applyD1Migrations(env.COLLECTIVE_DB, env.TEST_MIGRATIONS);
  await env.COLLECTIVE_DB.batch([
    env.COLLECTIVE_DB.prepare('INSERT OR IGNORE INTO catalogue_revisions (revision, published_at) VALUES (?1, ?2)').bind(1, '2026-09-01T00:00:00.000Z'),
    env.COLLECTIVE_DB.prepare('INSERT OR IGNORE INTO catalogue_revisions (revision, published_at) VALUES (?1, ?2)').bind(2, '2026-09-02T00:00:00.000Z'),
    env.COLLECTIVE_DB.prepare('INSERT OR IGNORE INTO catalogue_works (work_id, media_kind, preferred_title, revision) VALUES (?1, ?2, ?3, ?4)').bind('work_dandadan', 'anime', 'Dandadan', 1),
    env.COLLECTIVE_DB.prepare('INSERT OR IGNORE INTO catalogue_works (work_id, media_kind, preferred_title, revision) VALUES (?1, ?2, ?3, ?4)').bind('work_frieren', 'manga', 'Frieren', 2),
    env.COLLECTIVE_DB.prepare('INSERT OR IGNORE INTO catalogue_titles (work_id, locale, title) VALUES (?1, ?2, ?3)').bind('work_frieren', 'fr', 'Frieren'),
    env.COLLECTIVE_DB.prepare('INSERT OR IGNORE INTO catalogue_titles (work_id, locale, title) VALUES (?1, ?2, ?3)').bind('work_frieren', 'ja-Latn', 'Sousou no Frieren'),
    env.COLLECTIVE_DB.prepare('INSERT OR IGNORE INTO catalogue_external_references (provider, external_id, work_id) VALUES (?1, ?2, ?3)').bind('anilist', '154587', 'work_frieren'),
  ]);
});

describe('public D1 catalogue', () => {
  it('returns a bounded stable cursor page with public caching', async () => {
    const first = await SELF.fetch('https://tobirink.test/v1/catalogue?limit=1');
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('public, max-age=300, stale-while-revalidate=3600');
    expect(first.headers.get('x-content-type-options')).toBe('nosniff');
    const firstPage = await first.json<{ items: Array<{ id: string }>; nextCursor: string | null }>();
    expect(firstPage).toEqual({ items: [{ id: 'work_dandadan', mediaKind: 'anime', preferredTitle: 'Dandadan', revision: 1 }], nextCursor: '1.work_dandadan' });

    const secondUrl = new URL('https://tobirink.test/v1/catalogue');
    secondUrl.searchParams.set('limit', '1');
    secondUrl.searchParams.set('cursor', firstPage.nextCursor ?? '');
    const second = await SELF.fetch(secondUrl);
    expect(await second.json()).toEqual({ items: [{ id: 'work_frieren', mediaKind: 'manga', preferredTitle: 'Frieren', revision: 2 }], nextCursor: null });
  });

  it('returns one normalized work and resolves a bound external reference', async () => {
    const detail = await SELF.fetch('https://tobirink.test/v1/catalogue/works/work_frieren');
    expect(await detail.json()).toEqual({
      work: {
        externalReferences: [{ externalId: '154587', provider: 'anilist' }],
        id: 'work_frieren',
        mediaKind: 'manga',
        preferredTitle: 'Frieren',
        revision: 2,
        titles: [{ locale: 'fr', title: 'Frieren' }, { locale: 'ja-Latn', title: 'Sousou no Frieren' }],
      },
    });
    const resolved = await SELF.fetch('https://tobirink.test/v1/catalogue/resolve?provider=anilist&externalId=154587');
    expect(await resolved.json()).toEqual({ work: { id: 'work_frieren', mediaKind: 'manga', preferredTitle: 'Frieren', revision: 2 } });

    const insertTitle = env.COLLECTIVE_DB.prepare('INSERT OR IGNORE INTO catalogue_titles (work_id, locale, title) VALUES (?1, ?2, ?3)');
    await env.COLLECTIVE_DB.batch(Array.from({ length: 33 }, (_, index) => insertTitle.bind('work_frieren', 'x-test', `Alias ${index}`)));
    const bounded = await SELF.fetch('https://tobirink.test/v1/catalogue/works/work_frieren');
    const boundedWork = await bounded.json<{ work: { titles: unknown[] } }>();
    expect(boundedWork.work.titles).toHaveLength(32);
  });

  it('returns one public cached candidate and refuses an ambiguous fingerprint', async () => {
    const fingerprint = 'a'.repeat(64);
    const candidate = { externalId: '154587', mediaKind: 'ANIME', preSerialization: false, provider: 'anilist', titles: ['Frieren'] };
    const insert = env.COLLECTIVE_DB.prepare(`INSERT INTO favorite_public_cache
      (fingerprint, media_kind, identity_hash, parser_version, rules_version, references_json, candidate_json, created_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`);
    await insert.bind(fingerprint, 'ANIME', 'b'.repeat(64), 'parser-v4', 'rules-v3', '[{"provider":"anilist","externalId":"154587"}]', JSON.stringify(candidate), 1).run();
    const url = new URL('https://tobirink.test/v1/catalogue/favorites/resolve');
    for (const [name, value] of Object.entries({ fingerprint, mediaKind: 'ANIME', parserVersion: 'parser-v4', siteRulesVersion: 'rules-v3' })) url.searchParams.set(name, value);
    expect(await (await SELF.fetch(url)).json()).toEqual({ candidate });
    await insert.bind(fingerprint, 'ANIME', 'c'.repeat(64), 'parser-v4', 'rules-v3', '[{"provider":"kitsu-anime","externalId":"1"}]', JSON.stringify({ ...candidate, externalId: '1', provider: 'kitsu-anime' }), 1).run();
    expect((await SELF.fetch(url)).status).toBe(404);
  });

  it('searches exact titles case-insensitively with a stable bound', async () => {
    await env.COLLECTIVE_DB.batch([
      env.COLLECTIVE_DB.prepare('INSERT INTO catalogue_works (work_id, media_kind, preferred_title, revision) VALUES (?1, ?2, ?3, ?4)').bind('work_frieren_anime', 'anime', 'Frieren anime', 2),
      env.COLLECTIVE_DB.prepare('INSERT INTO catalogue_titles (work_id, locale, title) VALUES (?1, ?2, ?3)').bind('work_frieren_anime', 'fr', 'FRIEREN'),
    ]);
    try {
      const url = new URL('https://tobirink.test/v1/catalogue/search');
      url.searchParams.set('title', '  frieren  ');
      url.searchParams.set('limit', '1');
      const response = await SELF.fetch(url);

      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('public, max-age=300, stale-while-revalidate=3600');
      expect(await response.json()).toEqual({
        items: [{ id: 'work_frieren', mediaKind: 'manga', preferredTitle: 'Frieren', revision: 2 }],
      });
    } finally {
      await env.COLLECTIVE_DB.batch([
        env.COLLECTIVE_DB.prepare('DELETE FROM catalogue_titles WHERE work_id = ?1').bind('work_frieren_anime'),
        env.COLLECTIVE_DB.prepare('DELETE FROM catalogue_works WHERE work_id = ?1').bind('work_frieren_anime'),
      ]);
    }
  });

  it('rejects malformed bounds and treats injection text as data', async () => {
    for (const query of ['limit=0', 'limit=101', 'limit=1.5', 'cursor=broken']) {
      const url = new URL('https://tobirink.test/v1/catalogue');
      const [key, value] = query.split('=');
      url.searchParams.set(key ?? '', value ?? '');
      const response = await SELF.fetch(url);
      expect(response.status).toBe(400);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
    const injectionUrl = new URL('https://tobirink.test/v1/catalogue/resolve');
    injectionUrl.searchParams.set('provider', 'anilist');
    injectionUrl.searchParams.set('externalId', "154587' OR 1=1 --");
    const response = await SELF.fetch(injectionUrl);
    expect(response.status).toBe(400);

    for (const title of ['', 'x'.repeat(201), 'bad\u0000title']) {
      const searchUrl = new URL('https://tobirink.test/v1/catalogue/search');
      searchUrl.searchParams.set('title', title);
      const rejected = await SELF.fetch(searchUrl);
      expect(rejected.status).toBe(400);
      expect(rejected.headers.get('cache-control')).toBe('no-store');
    }

    const preparedUrl = new URL('https://tobirink.test/v1/catalogue/search');
    preparedUrl.searchParams.set('title', "Frieren' OR 1=1 --");
    const prepared = await SELF.fetch(preparedUrl);
    expect(prepared.status).toBe(200);
    expect(await prepared.json()).toEqual({ items: [] });
  });

  it('stores only reconstructible columns and proves hot queries use their indexes', async () => {
    const tableQueries = [
      'PRAGMA table_info(catalogue_works)',
      'PRAGMA table_info(catalogue_titles)',
      'PRAGMA table_info(catalogue_external_references)',
    ];
    const forbidden = ['consent_id', 'library', 'progress', 'url', 'user_id'];
    for (const query of tableQueries) {
      const columns = await env.COLLECTIVE_DB.prepare(query).all<{ name: string }>();
      expect(columns.results.map(({ name }) => name)).not.toEqual(expect.arrayContaining(forbidden));
    }

    const incremental = await env.COLLECTIVE_DB.prepare(`
      EXPLAIN QUERY PLAN SELECT work_id, media_kind, preferred_title, revision
      FROM catalogue_works WHERE (revision, work_id) > (?1, ?2)
      ORDER BY revision, work_id LIMIT ?3
    `).bind(0, '', 51).all<{ detail: string }>();
    expect(incremental.results.map(({ detail }) => detail).join(' ')).toContain('catalogue_works_incremental');

    const measured = await env.COLLECTIVE_DB.prepare(`
      SELECT work_id, media_kind, preferred_title, revision FROM catalogue_works
      WHERE (revision, work_id) > (?1, ?2) ORDER BY revision, work_id LIMIT ?3
    `).bind(0, '', 51).all();
    expect(measured.results).toHaveLength(2);
    expect(measured.meta.rows_read).toBeLessThanOrEqual(3);

    const references = await env.COLLECTIVE_DB.prepare(`
      EXPLAIN QUERY PLAN SELECT provider, external_id FROM catalogue_external_references
      WHERE work_id = ?1 ORDER BY provider, external_id LIMIT ?2
    `).bind('work_frieren', 32).all<{ detail: string }>();
    expect(references.results.map(({ detail }) => detail).join(' ')).toContain('catalogue_references_by_work');

    const resolution = await env.COLLECTIVE_DB.prepare(`
      EXPLAIN QUERY PLAN SELECT work_id FROM catalogue_external_references
      WHERE provider = ?1 AND external_id = ?2 LIMIT 1
    `).bind('anilist', '154587').all<{ detail: string }>();
    expect(resolution.results.map(({ detail }) => detail).join(' ')).toContain('sqlite_autoindex_catalogue_external_references_1');

    const titleSearch = await env.COLLECTIVE_DB.prepare(`
      EXPLAIN QUERY PLAN SELECT DISTINCT work_id FROM catalogue_titles INDEXED BY catalogue_titles_by_title
      WHERE title = ?1 COLLATE NOCASE ORDER BY work_id LIMIT ?2
    `).bind('frieren', 6).all<{ detail: string }>();
    expect(titleSearch.results.map(({ detail }) => detail).join(' ')).toContain('catalogue_titles_by_title');

    const measuredTitleSearch = await env.COLLECTIVE_DB.prepare(`
      SELECT DISTINCT work_id FROM catalogue_titles INDEXED BY catalogue_titles_by_title
      WHERE title = ?1 COLLATE NOCASE ORDER BY work_id LIMIT ?2
    `).bind('frieren', 6).all();
    expect(measuredTitleSearch.results).toHaveLength(1);
    expect(measuredTitleSearch.meta.rows_read).toBeLessThanOrEqual(2);
  });
});
