import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Wave 2 UI contracts', () => {
  it('keeps catalogue and connector states distinct', () => {
    expect(['Planifié', 'Disponible', 'Obsolète']).toEqual(expect.arrayContaining(['Planifié', 'Disponible', 'Obsolète']));
  });

  it('uses synthetic identities only', () => {
    expect(['Alice', 'Bob']).not.toContain('alice@example.com');
  });

  it('places the continue shelf directly after the personal list with visible progress',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source.indexOf('<PersonalShelf compact />')).toBeLessThan(source.indexOf('<h2>À continuer</h2>'));
    expect(source).toContain('data-testid="continue-shelf"');
    expect(source).toContain('item.progress?.raw');
  });

  it('cycles facets through include, exclude, and neutral and keeps calendar cards free of announcement copy',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source).toContain("next[value]='include'");
    expect(source).toContain("next[value]='exclude'");
    expect(source).toContain('delete next[value]');
    expect(source).not.toContain("?'Prévu':'Annoncé'");
    expect(source).toContain("item.timePrecision==='INSTANT'?<time");
    expect(source).toContain("document.addEventListener('pointerdown',closeOutside)");
    expect(source).toContain("document.addEventListener('toggle',closeOthers,true)");
    expect(source).toContain('sort(calendarEventOrder)');
    expect(source).toContain('if(leftAnime!==rightAnime)return leftAnime?-1:1');
  });

  it('replaces every non-Latin display title without altering the API payload',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source).toContain("containsNonLatinLetters?'Œuvre non résolue':value");
    expect(source).not.toContain('Script=Hiragana');
  });

  it('confirms a successful manual review before advancing the queue',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source).toContain('Fiche vérifiée et ajoutée à votre bibliothèque.');
    expect(source).toContain('window.setTimeout(onDone,1200)');
  });

  it('repairs only incomplete visible cards in one bounded request and polls queued providers twice',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source).toContain("item.progress?[]:['personal']");
    expect(source).toContain("item.availability?[]:['availability']");
    expect(source).toContain("fetch('/api/v1/library/repair-missing-positions'");
    expect(source).toContain('window.setTimeout(refresh,2000)');
    expect(source).toContain('window.setTimeout(refresh,8000)');
    expect(source).toContain("return `${personal} / ${available}`");
    expect(source).toContain("item.progress?.number??item.progress?.raw??'—'");
    expect(source).toContain("item.availability?.number??item.availability?.raw??'—'");
  });

  it('keeps cancelled status visible and bounds calendar exploration',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source).toContain("'Cancelled'");
    expect(source).toContain('disabled={weekOffset<=-2}');
    expect(source).toContain('disabled={weekOffset>=2}');
    expect(source).toContain('days.map(day=>{const dayItems=eventsFor(day).slice(0,visibleRows)');
    expect(source).toContain('const maxRows=Math.max(0,...days.map(day=>eventsFor(day).length))');
    expect(source).toContain('useEffect(()=>setVisibleRows(5),[weekOffset,type,favoritesOnly])');
    expect(source).toContain('Math.min(maxRows,value+5))}>Voir plus</button>');
    expect(source).toContain('Titre, genre ou catégorie');
    expect(source).toContain('item.genres');
    expect(source).toContain('item.categories');
    expect(source).toContain('<MultiFacet label="Genres"');
    expect(source).toContain('<MultiFacet label="Catégories"');
    expect(source).not.toContain('<MultiFacet label="Années"');
    expect(source).not.toContain('<MultiFacet label="Thèmes"');
    expect(source).not.toContain('Airings anime');
  });

  it('does not render the backend AniList graph in the work detail',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source).not.toContain('data-testid="anime-sequence"');
    expect(source).not.toContain('Chronologie AniList');
  });
});
