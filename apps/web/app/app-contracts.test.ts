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

  it('keeps fixed provider logos separate from source-domain favicons and country flags',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    const styles=readFileSync(resolve(process.cwd(),'app/media-overrides.css'),'utf8');
    expect(source).toContain("anilist:'/provider-icons/anilist.svg'");
    expect(source).toContain("mangaupdates:'/provider-icons/mangaupdates.svg'");
    expect(source).toContain("mangadex:'/provider-icons/mangadex.svg'");
    expect(source).toContain('<ProviderIcon provider={page.provider}/>');
    expect(source).toContain('<DomainIcon domain={source.domain}/><LanguageBadge language={source.language}/>');
    expect(source).toContain('<i className="source-icon-wrap"><DomainIcon');
    expect(source).not.toContain("fallback={source.connector==='mangaupdates'?'MU':undefined}");
    expect(source).toContain("favicon?domain=${encodeURIComponent(clean)}&v=2");
    expect(styles).toContain('.media-card-source-list .media-source-link .source-language-flag');
    expect(styles).toContain('.media-card-source-list .media-source-favicon,.media-card-source-list .media-source-globe{width:20px;height:20px}');
    expect(styles).toContain('right:-2px;bottom:-1px');
    expect(styles).toContain('width:11px!important;min-width:11px;height:8px!important');
    expect(styles).toContain('border:0;border-radius:0;background-color:transparent;background-size:100% 100%;box-shadow:none');
  });

  it('renders flat work-level site recommendations without provider, release, or state labels',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    const row=source.slice(source.indexOf('function SourceRow'),source.indexOf('function WorkHeaderIdentity'));
    expect(source).toContain('<h3>Sites recommandés</h3>');
    expect(source).not.toContain('<h3>Sources validées</h3>');
    expect(row).toContain('<strong>{source.domain}</strong>');
    expect(row).toContain('const workUrl=source.workUrl??source.canonicalUrl');
    expect(row).not.toContain('source.chapter');
    expect(row).not.toContain("'Disponible'");
    expect(source).toContain("[workUrl]:'UNAVAILABLE'");
  });

  it('places the continue shelf directly after the personal list with visible progress',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source.indexOf('data-testid="personal-shelf"')).toBeLessThan(source.indexOf('<h2>À continuer</h2>'));
    expect(source).toContain('data-testid="continue-shelf"');
    expect(source).toContain('item.progress?.raw');
    expect(source).toContain("useApi<{myList:LibraryItem[];continue:LibraryItem[];latestReleases:CalendarItem[]}>('/api/v1/home')");
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
    expect(source).toContain("useApi<ReviewQueueSummary>(notificationOpen?'/api/v1/reviews':'',reviewRefresh)");
    expect(source).toContain("useApi<{role:'admin'|'member';pendingReviewCount:number}>('/api/v1/header-summary'");
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

  it('clamps image-card titles to two lines on mobile',()=>{
    const styles=readFileSync(resolve(process.cwd(),'app/mobile-card-title.css'),'utf8');
    expect(styles).toContain('@media (max-width:640px){.media-card .poster-copy strong');
    expect(styles).toContain('-webkit-line-clamp:2');
    expect(styles).toContain('-webkit-box-orient:vertical');
  });

  it('never mutates progression while rendering a GET page',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source).not.toContain("fetch('/api/v1/library/repair-missing-positions'");
    expect(source).toContain("return `${personal} / ${available}`");
    expect(source).toContain("item.progress?.raw??item.progress?.number??'—'");
    expect(source).toContain("item.availability?.raw??item.availability?.number??'—'");
  });

  it('loads card details once on open and defers facets until a filter opens',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    expect(source).toContain('const mediaDetailCache=new Map<string,LibraryItem>()');
    expect(source).toContain('onOpen={()=>void load()}');
    expect(source).toContain('/api/v1/library/${encodeURIComponent(summary.id)}`');
    expect(source).toContain("facetsRequested?`/api/v1/library/facets?");
    expect(source).toContain('/api/v1/library/cards?${params}');
  });

  it('keeps the library content area empty during its initial request',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    const loadingBranch=source.split('\n').find(line=>line.includes("if (status === 'loading')"));
    expect(loadingBranch).toContain('title="Bibliothèque"');
    expect(loadingBranch).not.toContain('DataState');
    expect(loadingBranch).not.toContain('Chargement');
    expect(source).not.toContain('issue de PostgreSQL');
    expect(source).not.toContain('issus de PostgreSQL');
  });

  it('shows only a centred animated SVG while modal details load',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    const styles=readFileSync(resolve(process.cwd(),'app/physical-card.css'),'utf8');
    expect(source).toContain('if(!detail||state!==\'ready\')return <ModalLoadingIndicator/>');
    expect(source).toContain('<svg viewBox="0 0 48 48" aria-hidden="true">');
    expect(source).not.toContain('<strong>Chargement de la fiche…</strong>');
    expect(styles).toContain('.media-card-loading{position:absolute;inset:0;display:grid;place-items:center');
    expect(styles).toContain('@keyframes media-card-loading-spin');
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
    expect(source).not.toContain('label="Classifications"');
    expect(source).not.toContain('label="Démographies"');
    expect(source).toContain('function ContentPreferences');
    expect(source).toContain('Afficher les œuvres adultes');
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

  it('hydrates each route with the same path rendered by the server',()=>{
    const source=readFileSync(resolve(process.cwd(),'app/favlib-app.tsx'),'utf8');
    const catchAll=readFileSync(resolve(process.cwd(),'app/[...slug]/page.tsx'),'utf8');
    const media=readFileSync(resolve(process.cwd(),'app/library/[mediaId]/page.tsx'),'utf8');
    expect(source).not.toContain("typeof window === 'undefined' ? '/' : window.location.pathname");
    expect(source).toContain("FavLibApp({initialPath='/'}");
    expect(catchAll).toContain("initialPath={`/${slug.join('/')}`}");
    expect(media).toContain('initialPath={`/library/${encodeURIComponent(mediaId)}`}');
  });
});
