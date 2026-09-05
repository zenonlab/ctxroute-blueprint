import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  emptyLibraryFilters,
  libraryFiltersStates,
  libraryFiltersVariants,
} from './index';
import type { LibraryFiltersValue } from './index';

const component = readFileSync(new URL('./LibraryFilters.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('./LibraryFilters.module.css', import.meta.url), 'utf8');
const preview = readFileSync(new URL('./LibraryFilters.preview.tsx', import.meta.url), 'utf8');

describe('LibraryFilters', () => {
  it('publishes one bounded library contract', () => {
    expect(libraryFiltersVariants).toEqual(['library']);
    expect(libraryFiltersStates).toEqual(['default', 'filtered', 'disabled']);
    expect(emptyLibraryFilters).toEqual({ progress: {}, query: '', status: {}, type: {} });
  });

  it('composes the existing search and facet primitives', () => {
    expect(component).toMatch(/components\/search-field/);
    expect(component).toMatch(/components\/facet-select/);
    expect(component.match(/<FacetSelect/g)).toHaveLength(3);
    expect(component).toContain('label="Type"');
    expect(component).toContain('label="Statut"');
    expect(component).toContain('label="Progression"');
    expect(component).toMatch(/options\.type\.length > 0/);
    expect(component).toMatch(/options\.status\.length > 0/);
    expect(component).toMatch(/options\.progress\.length > 0/);
  });

  it('does not recreate a field, select or badge', () => {
    expect(component).not.toMatch(/<input|<select|Badge|badge/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  });

  it('keeps every filter serializable', () => {
    const value: LibraryFiltersValue = {
      progress: { ongoing: 'include' },
      query: 'frieren',
      status: { review: 'exclude' },
      type: { manga: 'include' },
    };

    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });

  it('emits complete immutable values for every control', () => {
    expect(component).toContain("onChange={(event) => onChange({ ...value, query: event.currentTarget.value })}");
    expect(component).toContain('onChange={(type) => onChange({ ...value, type })}');
    expect(component).toContain('onChange={(status) => onChange({ ...value, status })}');
    expect(component).toContain('onChange={(progress) => onChange({ ...value, progress })}');
  });

  it('documents the shared internal facet search in the workbench', () => {
    expect(preview).toMatch(/id: 'library-filters'/);
    expect(preview).toMatch(/recherche interne des facettes réutilisent le même champ/);
  });
});
