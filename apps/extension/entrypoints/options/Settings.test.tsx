import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { settingsStates, settingsVariants } from './index';

const publicSurface = readFileSync(new URL('./Settings.tsx', import.meta.url), 'utf8');
const shell = readFileSync(new URL('./OrganizerSettings.tsx', import.meta.url), 'utf8');
const editor = readFileSync(new URL('./OrganizerFolderEditor.tsx', import.meta.url), 'utf8');
const model = readFileSync(new URL('./organizer.types.ts', import.meta.url), 'utf8');
const css = readFileSync(new URL('./Settings.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./Settings.preview.tsx', import.meta.url), 'utf8');

describe('Settings organizer surface', () => {
  it('publishes the organizer states', () => {
    expect(settingsVariants).toEqual(['organizer']);
    expect(settingsStates).toEqual(['ready', 'loading', 'partial', 'offline', 'error', 'blocked']);
  });

  it('keeps one public organizer implementation and the safe preview sequence', () => {
    expect(publicSurface).toContain("export { Settings } from './OrganizerSettings'");
    expect(shell).toContain('Organiser mes favoris');
    expect(shell).toContain('Arbre des dossiers');
    expect(shell).toContain('Vérifier le tri');
    expect(shell).toContain('Aperçu du tri');
    expect(shell).toContain('Appliquer le tri');
    expect(shell).toContain('Restaurer l’organisation précédente ?');
    expect(shell).toContain('props.onApplyPreview ?');
    expect(shell).toContain('props.onRestore ?');
    expect(shell).toContain('folderCount === 0 || !props.configurationValid');
    expect(shell).toContain("props.onRequestPreview() !== false");
    expect(shell).toContain("useState<'config' | 'preview'>");
  });

  it('renders the sibling rank inside the folder SVG and a recursive tree', () => {
    expect(editor).toContain('folderPriority={isRoot ? undefined : index + 1}');
    expect(editor).toContain('<OrganizerFolderEditor');
    expect(editor).toContain('role="group"');
    expect(editor).toContain('onReorderFolder(draggedId, folder.id)');
    expect(editor).not.toMatch(/folderIcon[^]*<span>\{folder\.priority\}/);
  });

  it('renders configuration and preview as full pages rather than modal-like windows', () => {
    expect(shell).toContain('className={styles.settingsPage}');
    expect(shell).toContain('className={styles.previewPage}');
    expect(shell).toContain("data-view={view}");
    expect(shell).not.toContain('styles.window');
    expect(css).not.toContain('.window');
    expect(css).not.toMatch(/box-shadow: var\(--shadow-overlay\)/);
    expect(css).not.toMatch(/max-width: var\(--size-content-wide\)/);
    expect(css).toContain('min-height: 100dvh');
    expect(css).toContain('align-content: start');
  });

  it('opens real FavLib filters rather than a decorative settings action', () => {
    expect(editor).toContain('aria-controls={panelId}');
    expect(editor).toContain('aria-expanded={filtersOpen}');
    expect(editor).toContain('<FilterPanel');
    expect(editor).toContain("changeGroup('types'");
    expect(editor).toContain("changeGroup('statuses'");
    expect(editor).toContain("changeGroup('progressStates'");
    expect(editor).toContain('filterOptions.types.length > 0');
    expect(editor).toContain('filterOptions.statuses.length > 0');
    expect(editor).toContain('filterOptions.progressStates.length > 0');
    expect(editor).toContain('disabled={!selected}');
    expect(model).toContain('stoppedAfter?: number');
  });

  it('receives recursive serializable models and callbacks instead of browser APIs', () => {
    expect(model).toContain('children: readonly OrganizerFolder[]');
    expect(model).toContain('previewItems: readonly OrganizerMove[]');
    for (const source of [publicSurface, shell, editor, model, preview]) {
      expect(source).not.toMatch(/chrome\.|browser\.|indexedDB|fetch\(/);
    }
  });

  it('invalidates the preview on every tree edit in the functional fixture', () => {
    expect(preview).toContain('setPreviewFresh(false)');
    expect(preview).toContain('onConditionsChange=');
    expect(preview).toContain('onReorderFolder=');
    expect(preview).toContain('onRequestPreview={() => { setPreviewFresh(true)');
    expect(preview).toContain("return id;");
  });

  it('uses only design tokens and narrow responsive rules', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(css).toContain('@media (max-width: 48rem)');
    expect(css).toContain('@media (max-width: 32rem)');
    expect(css).toContain('prefers-reduced-motion: reduce');
    expect(css).not.toContain('--opacity-muted');
    expect(css).not.toContain('--font-weight-normal');
  });

  it('is discoverable with complete Workbench sources', () => {
    expect(preview).toMatch(/id: 'settings'/);
    for (const source of [
      'organizer.types.ts',
      'OrganizerSettings.tsx',
      'OrganizerFolderEditor.tsx',
      'Settings.module.css',
      'Settings.preview.tsx',
      'Settings.test.tsx',
    ]) {
      expect(preview).toContain(source);
    }
    expect(preview).toContain('Arbre récursif · filtres réels · aperçu invalidable');
  });

  it('removes the generic dashboard and remains inside the extension shell', () => {
    for (const stale of ['Bibliothèque locale', 'Navigation et favoris', 'Projection navigateur', 'Review collective', 'Agenda et notifications', 'Données locales', 'Télécharger le calendrier', 'Diagnostic technique']) {
      expect(shell).not.toContain(stale);
    }
    expect(shell).toContain('Extension Tobirink');
    expect(shell).toContain('<TobirinkLogo');
    expect(shell).not.toMatch(/MemberNavigation|Recherche globale|Correspondances à vérifier|<Switch|<Surface/);
  });
});
