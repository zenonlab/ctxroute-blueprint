import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source=readFileSync(join(process.cwd(),'app/favlib-app.tsx'),'utf8');
const styles=readFileSync(join(process.cwd(),'app/media-overrides.css'),'utf8');
const physicalCardStyles=readFileSync(join(process.cwd(),'app/physical-card.css'),'utf8');

describe('verso de modal œuvre',()=>{
  it('déplie l’en-tête sur toute la carte et masque les onglets pendant les relations',()=>{
    expect(source).toContain('aria-controls={`media-related-${item.id}`}');expect(source).toContain('Toutes les œuvres reliées');expect(source).toContain('relatedWorks.map(work=><RelatedWorkRow');expect(source).toContain('<Cover item={{id:work.id,title:work.title,coverUrl:work.coverUrl}}/>');expect(physicalCardStyles).toContain('.media-related-panel{min-height:0;flex:1;overflow-y:auto');expect(physicalCardStyles).toContain('.media-card-related-toggle[aria-expanded=true]');
  });
  it('affiche des onglets courts et aucun compteur de relations dans le type',()=>{
    expect(source).toContain("const tabs=[['links','Liens'],['info','Informations'],['similar','Découvertes']]");
    expect(source).toContain('<span className="eyebrow">{item.type}</span>');
    expect(source).not.toContain('relatedWorks.length} œuvres');
  });
  it('reste sobre et conserve les invariants de source',()=>{
    expect(styles).toContain('object-fit:contain');
    expect(source).toContain('item.sources?.length');
    expect(source).toContain('parsedTitle');
    expect(source).toContain('Chapitre');
    expect(source).toContain("source.connector==='anilist'?'AniList'");
    expect(source).toContain("source.status==='MOVED'");
    expect(source).toContain('Lien déplacé');
    expect(source).toContain('source.canonicalUrl');
    expect(source).toContain('faviconCandidates');
    expect(source).toContain('/api/v1/catalog/favicon?domain=');
    expect(styles).toContain('a.media-source-link');
    expect(styles).toContain('display:inline-flex;align-items:center;gap:5px');
    expect(styles).toContain('align-items:baseline;gap:6px');
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
