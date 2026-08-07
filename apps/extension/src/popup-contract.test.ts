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
});
