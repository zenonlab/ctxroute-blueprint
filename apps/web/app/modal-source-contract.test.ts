import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source=readFileSync(join(process.cwd(),'app/favlib-app.tsx'),'utf8');
const styles=readFileSync(join(process.cwd(),'app/media-overrides.css'),'utf8');

describe('verso de modal œuvre',()=>{
  it('reste sobre et conserve les invariants de source',()=>{
    expect(styles).toContain('object-fit:contain');
    expect(source).toContain('item.sources?.length');
    expect(source).toContain('parsedTitle');
    expect(source).toContain('Chapitre');
    expect(source).toContain("source.connector==='anilist'?'AniList'");
    expect(source).toContain("source.status==='MOVED'");
    expect(source).toContain('Lien déplacé');
    expect(source).toContain('source.canonicalUrl');
    expect(source).toContain('https://${source.domain}/favicon.ico');
    expect(source).toContain('<Globe');
    expect(source).toContain("source.status==='UNAVAILABLE'");
    expect(source).toContain('href={source.canonicalUrl}');
    expect(source).toContain('Site inaccessible');
    expect(source).toContain('source-reports');
    expect(source).toContain('navigator.clipboard');
    expect(source).toContain('providerPages');
    expect(source).toContain("provider==='anilist'?'AniList':'MangaUpdates'");
    expect(source).toContain("item.type==='ANIME'?'anilist':'mangaupdates'");
    expect(source).toContain("provider==='mangaupdates'?'MangaUpdates':'MangaDex'");
    expect(source).toContain("{(['anilist','mangaupdates'] as const).map(provider=>");
    expect(source).toContain('uniqueFavorites');
    expect(source).not.toContain('Aucune sortie planifiée connue.');
    expect(source).not.toContain('Source personnelle ·');
    expect(source).not.toContain('Disponibilité réelle');
  });
});
