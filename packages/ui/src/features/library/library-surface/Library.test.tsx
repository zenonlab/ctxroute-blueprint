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
    expect(component).toContain('<p>Collection</p><h1>Bibliothèque</h1>');
    expect(component.indexOf('className={styles.header}')).toBeLessThan(component.indexOf("state === 'empty'"));
    expect(css).toMatch(/minmax\(min\(12\.25rem, 100%\), 12\.25rem\)/);
    expect(css).toMatch(/repeat\(2, minmax\(0, 1fr\)\)/);
    expect(component).toContain('layout="centered"');
    expect(component).toContain('icon="library-big"');
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/iu);
  });

  it('accepts a real stored source without changing the Extension fallback', () => {
    expect(component).toContain('item.href ?? `#work-${item.id}`');
  });

  it('distinguishes an absent extension from an installed empty library', () => {
    expect(component).toContain('Extension TobiRink requise');
    expect(component).toContain('analyse automatiquement les favoris HTTP(S) de votre navigateur');
    expect(component).toContain('Aucune œuvre trouvée');
    expect(component).not.toContain('Importez vos favoris');
  });
});
