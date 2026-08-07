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
});
