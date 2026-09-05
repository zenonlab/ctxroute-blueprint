import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { libraryStates, libraryVariants } from './index';

const component = readFileSync(new URL('./Library.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./Library.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./Library.preview.tsx', import.meta.url), 'utf8');

describe('Library', () => {
  it('publishes the local surface states', () => {
    expect(libraryVariants).toEqual(['library']);
    expect(libraryStates).toEqual(['ready', 'loading', 'empty', 'review', 'partial', 'offline', 'error', 'blocked']);
  });

  it('reuses the existing library components', () => {
    for (const componentName of ['MemberNavigation', 'LibraryFilters', 'WorkCard', 'FeedbackState', 'Button']) {
      expect(component).toContain(componentName);
    }
    expect(component).not.toMatch(/ProgressControl|<input|<select/);
  });

  it('starts directly with content and centers non-usable states', () => {
    expect(component).not.toMatch(/<header|library-title|Bibliothèque locale|Vos œuvres|totalCount/);
    expect(component).toMatch(/aria-label="Bibliothèque"/);
    expect(component).toMatch(/layout="centered"/);
    expect(component).toMatch(/icon="library-big"/);
    expect(component).toMatch(/onDownloadExtension/);
    expect(component).toMatch(/action=\{onDownloadExtension/);
    expect(component).toMatch(/Télécharger l’extension/);
    expect(component).not.toMatch(/onImport|>Importer</);
    expect(component).toMatch(/\{usable \? \([\s\S]*<LibraryFilters/);
    expect(css).toMatch(/\.centeredState[\s\S]*justify-self: center/);
    expect(css).toMatch(/\.preview \.library[\s\S]*min-height: calc\(var\(--size-column-min\) \* 2\)/);
    expect(css).not.toMatch(/\.feedbackAction|\.count|\.header/);
  });

  it('keeps synchronized progress only on the card', () => {
    expect(component).toMatch(/indicator={item\.progress}/);
    expect(component).toMatch(/variant="library"/);
    expect(component).not.toMatch(/selectedWork|onCommitProgress|Badge|badge/);
  });

  it('implements local filtering and pagination in the fixture', () => {
    expect(preview).toMatch(/useMemo/);
    expect(preview).toMatch(/setLimit\(\(current\) => current \+ 2\)/);
    expect(preview).toMatch(/setFilters/);
    expect(preview).toMatch(/Téléchargement de l’extension demandé/);
  });

  it('uses tokens and a responsive two-column card grid', () => {
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(css).toMatch(/repeat\(2, minmax\(0, 1fr\)\)/);
  });

  it('is discoverable with complete Workbench sources', () => {
    expect(preview).toMatch(/id: 'library'/);
    expect(preview).toMatch(/entrypoints\/library\/Library\.tsx/);
  });

  it('receives the shared member navigation through its public contract', () => {
    expect(component).toMatch(/navigation: MemberNavigationConfig/);
    expect(component).toMatch(/<MemberNavigation \{\.\.\.navigation\}>/);
    expect(preview).toMatch(/activeId: 'library'/);
    expect(component).not.toMatch(/Ouvrir Review|onOpenReview/);
  });
});
