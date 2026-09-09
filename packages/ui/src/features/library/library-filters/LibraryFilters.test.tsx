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
    expect(emptyLibraryFilters).toEqual({ format: {}, genre: {}, progress: {}, query: '', sort: 'ADDED_DESC', source: {}, status: {}, type: {}, year: {} });
  });

  it('composes the existing search and facet primitives', () => {
    expect(component).toMatch(/components\/search-field/);
    expect(component).toMatch(/components\/facet-select/);
    expect(component.match(/<FacetSelect/g)).toHaveLength(7);
    expect(component).toContain('label="Type"');
    expect(component).toContain('label="Statut"');
    expect(component).toContain('label="Progression"');
    expect(component).toContain('label="Genre"');
    expect(component).toContain('label="Format"');
    expect(component).toContain('label="Année"');
    expect(component).toContain('label="Source"');
    expect(component).toMatch(/options\.type\.length > 0/);
    expect(component).toMatch(/options\.status\.length > 0/);
    expect(component).toMatch(/options\.progress\.length > 0/);
  });

  it('uses one labelled native sort field and no badge', () => {
    expect(component).not.toMatch(/<input|Badge|badge/);
    expect(component).toMatch(/<label className={styles\.sortField}>/);
    expect(component).toMatch(/<select disabled=/);
    expect(css).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
  });

  it('keeps every filter serializable', () => {
    const value: LibraryFiltersValue = {
      format: {},
      genre: { fantasy: 'include' },
      progress: { ongoing: 'include' },
      query: 'frieren',
      sort: 'POPULARITY_DESC',
      source: {},
      status: { review: 'exclude' },
      type: { manga: 'include' },
      year: {},
    };

    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });

  it('emits complete immutable values for every control', () => {
    expect(component).toContain("onChange={(event) => onChange({ ...value, query: event.currentTarget.value })}");
    expect(component).toContain('onChange={(type) => onChange({ ...value, type })}');
    expect(component).toContain('onChange={(status) => onChange({ ...value, status })}');
    expect(component).toContain('onChange={(progress) => onChange({ ...value, progress })}');
    expect(component).toContain('onChange={(genre) => onChange({ ...value, genre })}');
  });

  it('documents the shared internal facet search in the workbench', () => {
    expect(preview).toMatch(/id: 'library-filters'/);
    expect(preview).toMatch(/recherche interne des facettes réutilisent le même champ/);
  });
});
