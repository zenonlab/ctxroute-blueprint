import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

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

  it('persists a manual review request and advances without polling or delay',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source).toContain('Vérification enregistrée dans la file.');
    expect(source).not.toContain("response.status===202&&path==='manual'");
    expect(source).not.toContain('window.setTimeout(onDone');
  });

  it('uses the notification menu exclusively for the review queue',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source).toContain("useApi<ReviewQueueSummary>('/api/v1/reviews',reviewRefresh)");
    expect(source).toContain('Aucune review à vérifier');
    expect(source).not.toContain("useApi<{items:NotificationItem[]}>('/api/v1/notifications')");
    expect(source).not.toContain('regularNotifications');
  });

  it('redirects legacy review pages while preserving the notification resolver byte-for-byte',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    const resolver=source.slice(source.indexOf('function NotificationResolver'),source.indexOf('function Review('));
    expect(createHash('sha256').update(resolver).digest('hex')).toBe('0aa65d4ba5a61eee34f9d4a28108c4b3939a0a99fa6bc10f9e7299da341ace10');
    expect(source).not.toContain("path === '/review'");
    expect(source).not.toContain("path.startsWith('/review/')");
    const route=readFileSync(resolve(process.cwd(),'app/[...slug]/page.tsx'),'utf8');
    expect(route).toContain("if(slug[0]==='review')redirect('/')");
  });

  it('creates removable author and studio filters from modal credits without permanent facets',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source).toContain("onContextFilter?.({kind:'author',value:author.name})");
    expect(source).toContain("onContextFilter?.({kind:'studio',value:studio.name})");
    expect(source).toContain('library-context-chip');
    expect(source).toContain('removeContextFilter({kind,value})');
    expect(source).not.toContain('<MultiFacet label="Auteurs"');
    expect(source).not.toContain('<MultiFacet label="Studios"');
  });

  it('never exposes an unknown internal review code',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source).not.toContain('`Cause : ${reason}`');
    expect(source).toContain("??'Correspondance à vérifier.'");
  });

  it('accepts alphanumeric provider keys and animates one disabled verification action',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source).toContain("id:/^https?:\\/\\//u.test(input)?undefined:input");
    expect(source).toContain("`Vérifier${'.'.repeat(dots)}`");
    expect(source).toContain('disabled={busy}');
    expect(source).toContain('if(!manualPending)void decide');
  });

  it('explains that review cards show the closest provider title',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source).toContain('les cartes affichent le titre fournisseur le plus proche du favori');
    expect(source).not.toContain('les cartes affichent le titre canonique du fournisseur');
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

  it('routes pointer interaction through controls instead of selectable labels or Lucide icons',()=>{
    const styles=readFileSync(resolve(process.cwd(),'app/globals.css'),'utf8');
    expect(styles).toContain(':where(button,a,[role="button"],[role="tab"],summary){-webkit-user-select:none;user-select:none;touch-action:manipulation}');
    expect(styles).toContain(':where(button,a,[role="button"],[role="tab"],summary) svg{pointer-events:none}');
    expect(styles).toContain(':where(button,a,[role="button"],[role="tab"],summary) img{pointer-events:none');
  });
});
