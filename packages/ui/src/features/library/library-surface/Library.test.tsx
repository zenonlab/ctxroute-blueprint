import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { libraryStates, libraryVariants } from './index';

const component = readFileSync(new URL('./Library.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./Library.module.css', import.meta.url), 'utf8');

describe('shared Library surface', () => {
  it('publishes the Workbench contract and composition', () => {
    expect(libraryVariants).toEqual(['library']);
    expect(libraryStates).toEqual(['ready', 'loading', 'empty', 'review', 'partial', 'offline', 'error', 'blocked']);
    for (const componentName of ['MemberNavigation', 'LibraryFilters', 'WorkCard', 'FeedbackState', 'Button']) expect(component).toContain(componentName);
  });

  it('keeps the approved card grid and centered SVG states', () => {
    expect(css).toMatch(/minmax\(min\(12\.25rem, 100%\), 12\.25rem\)/);
    expect(css).toMatch(/repeat\(2, minmax\(0, 1fr\)\)/);
    expect(component).toContain('layout="centered"');
    expect(component).toContain('icon="library-big"');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/iu);
  });

  it('keeps structured card details without a counter banner', () => {
    expect(component).not.toContain('Statistiques de la bibliothèque');
    expect(component).not.toContain('statistics.inProgress');
    expect(component).not.toContain('statistics.completed');
    expect(component).toContain('item.detail ?? item.source');
  });

  it('never manufactures an inert work fragment', () => {
    expect(component).toContain('href={item.href}');
    expect(component).not.toContain('#work-');
  });

  it('distinguishes an absent extension from an installed empty library', () => {
    expect(component).toContain('Extension TobiRink requise');
    expect(component).toContain('retrouver automatiquement les œuvres de vos favoris');
    expect(component).toContain('Aucune œuvre trouvée');
    expect(component).not.toContain('Importez vos favoris');
  });
});
