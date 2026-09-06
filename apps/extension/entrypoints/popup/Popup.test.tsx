import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { popupStates, popupVariants } from './index';

const component = readFileSync(new URL('./Popup.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./Popup.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./Popup.preview.tsx', import.meta.url), 'utf8');

describe('Popup', () => {
  it('publishes every state from the surface matrix', () => {
    expect(popupVariants).toEqual(['page', 'agenda', 'settings']);
    expect(popupStates).toEqual(['ready', 'loading', 'empty', 'error', 'blocked']);
  });

  it('restores the bounded extension shell and its three internal panels', () => {
    expect(component).toMatch(/Cette œuvre/);
    expect(component).toMatch(/Continuer mes œuvres/);
    expect(component).toMatch(/Sorties/);
    expect(component).toMatch(/Réglages/);
    expect(component).not.toMatch(/libraryCount|reviewCount|nextRelease|Prochaine sortie|En un regard/);
    expect(css).toMatch(/height: calc\(var\(--space-8\) \* 16 \+ var\(--space-6\) \+ var\(--space-1\)\)/);
    expect(css).toMatch(/min-width: calc\(var\(--size-column-min\) \* 2\)/);
    expect(css).toMatch(/background: var\(--color-canvas\)/);
    expect(css).toMatch(/\.primaryCard\s*{[^}]*width: 100%/s);
    expect(css).toMatch(/touch-action: pan-y/);
    expect(css).not.toMatch(/scrollbar-gutter/);
    expect(component).toMatch(/<TobirinkLogo className={styles\.brandLogo}/);
    expect(component).not.toMatch(/brandMark|>扉</);
  });

  it('reuses the shared WorkCard and compact tab navigation', () => {
    expect(component).toMatch(/<Navigation/);
    expect(component).toMatch(/<WorkCard/);
    expect(component).toMatch(/variant="active-work"/);
    expect(component).toMatch(/variant="library"/);
    expect(component).toMatch(/variant="compact"/);
    expect(component).toMatch(/label="Navigation de l’extension"/);
    expect(component).toMatch(/onActiveChange/);
    expect(component).not.toMatch(/href: '#library'|href: '#agenda'|href: '#settings'/);
  });

  it('keeps runtime values behind typed models and callbacks', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(component).toMatch(/PopupPageModel/);
    expect(component).toMatch(/PopupContinuationsModel/);
    expect(component).toMatch(/PopupPreferencesModel/);
    expect(component).toMatch(/PopupConnection/);
    expect(component).toMatch(/preferences\.items\.map/);
    expect(component).toMatch(/onPreferenceChange\?\.\(preference\.id, enabled\)/);
    expect(component).toMatch(/onOpenAgenda/);
    expect(component).toMatch(/event\.preventDefault\(\)/);
    expect(component).not.toMatch(/Aucune sortie à venir|Les prochaines dates apparaîtront ici/);
    expect(component).not.toMatch(/Mise à jour des favoris|Observer la navigation|Assistant de navigation/);
    expect(component).not.toMatch(/browser\.|indexedDB|https?:\/\//);
    expect(component).toMatch(/aria-labelledby=/);
    expect(component).toMatch(/controlsId: 'popup-page-panel'/);
    expect(preview).toMatch(/Préférences rapides/);
    expect(preview).toMatch(/initialPanel={variant}/);
  });

  it('is discoverable with complete Workbench sources', () => {
    expect(preview).toMatch(/id: 'popup'/);
    expect(preview).toMatch(/entrypoints\/popup\/Popup\.tsx/);
  });
});
