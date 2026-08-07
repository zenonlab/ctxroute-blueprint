import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('manual provider review boundary',()=>{
  it('queues an opaque synthetic MangaUpdates id instead of calling the provider in the API',()=>{
    const source=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
    const route=source.slice(source.indexOf('/api/v1/reviews/:id/manual'),source.indexOf('/api/v1/reviews/:id/report'));
    expect(route).toContain("graphile_worker.add_job('manual-review-provider'");
    expect(route).toContain("priority := -100");
    expect(route).not.toContain('fetchMangaUpdatesSeries');
    expect(source).toContain('/^[A-Za-z0-9]{1,80}$/u');
  });

  it('resolves an AniList chain review only into the personal projection',()=>{
    const source=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');
    const resolver=source.slice(source.indexOf('async function resolveReview'),source.indexOf('async function recordCollectiveEndorsement'));
    expect(resolver).toContain('x.provider === "anilist-chain"');
    expect(resolver).toContain('INSERT INTO user_anime_work_choice');
    expect(resolver.indexOf('x.provider === "anilist-chain"')).toBeLessThan(resolver.indexOf('mangaupdates-enrichment'));
    expect(resolver).toContain('decision IS NULL');
  });
});
