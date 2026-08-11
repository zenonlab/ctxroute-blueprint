import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../entrypoints/popup.html',import.meta.url),'utf8');
const script=readFileSync(new URL('./popup.ts',import.meta.url),'utf8');

describe('compact popup contracts',()=>{
  it('opens on Page and exposes three bottom navigation panels',()=>{
    expect(html.match(/class="panel"/g)).toHaveLength(3);
    expect(html).toContain('class="tab active" data-panel="0"');
    expect(html).toContain('<span>Page</span>');
    expect(html).toContain('<span>Liste</span>');
    expect(html).toContain('<span>Réglages</span>');
  });
  it('supports horizontal swipe and has no manual synchronization action',()=>{
    expect(script).toContain("viewport.addEventListener('pointerup'");
    expect(html).not.toContain('Synchroniser maintenant');
    expect(html).not.toContain('Appairer à nouveau');
  });
  it('keeps pairing conditional and binds the sole setting to the existing preference',()=>{
    expect(script).toContain('pairing.hidden=linked');
    expect(script).toContain('autoUpdateFavorites:next');
    expect(html).toContain('Favori automatique');
  });
  it('uses the same personal/available counter as the library card without source labels',()=>{
    expect(script).toContain("return `${personal} / ${available}`");
    expect(script).toContain("<small>${escapeHtml(availabilityCounter(item))}</small>");
    expect(script).not.toContain("<small>${escapeHtml(item.type)}");
    expect(script).not.toContain('position ${escapeHtml(item.progress');
    expect(script).not.toContain('Dernière sortie ·');
  });
  it('does not expose raw bookmark or synchronization internals while the library loads',()=>{
    expect(script).not.toContain('Favori local · synchronisation');
    expect(script).not.toContain('function localRenderList');
    expect(script).toContain("loadingMarkup(syncing?'Importation de votre bibliothèque…':'Chargement de votre bibliothèque…')");
  });
  it('explains pairing and import latency instead of showing an unexplained skeleton',()=>{
    expect(script).toContain('Création du code et ouverture de FavLib…');
    expect(script).toContain('Appairage réussi. Votre bibliothèque est en cours d’importation');
    expect(script).toContain('role="status"');
    expect(script).toContain('Importation en cours : les autres œuvres apparaîtront progressivement.');
  });
  it('deduplicates works and avoids repeating an unavailable-cover sentence on every card',()=>{
    expect(script).toContain('uniqueById((await response.json()');
    expect(script).not.toContain('Couverture<br>indisponible');
    expect(script).toContain('aria-label="Visuel en préparation"');
  });
  it('allows enough time and retries for authenticated cover downloads',()=>{
    expect(script).toContain('const coverFetch={attempts:3,timeoutMs:10000}');
    expect(script).toContain('},coverFetch)');
  });
});
