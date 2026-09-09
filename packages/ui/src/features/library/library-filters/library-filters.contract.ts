import type { FacetOption, FacetSelection } from '../../../components/facet-select';

export const libraryFiltersVariants = ['library'] as const;
export const libraryFiltersStates = ['default', 'filtered', 'disabled'] as const;

export type LibraryFiltersVariant = (typeof libraryFiltersVariants)[number];
export type LibraryFiltersState = (typeof libraryFiltersStates)[number];
export const librarySortValues = ['ADDED_DESC', 'PROGRESS_DESC', 'POPULARITY_DESC', 'TITLE_ASC', 'TITLE_DESC', 'YEAR_DESC'] as const;
export type LibrarySortValue = (typeof librarySortValues)[number];

export interface LibraryFiltersValue {
  format: FacetSelection;
  genre: FacetSelection;
  query: string;
  progress: FacetSelection;
  sort: LibrarySortValue;
  source: FacetSelection;
  status: FacetSelection;
  type: FacetSelection;
  year: FacetSelection;
}

export interface LibraryFilterOptions {
  format: readonly FacetOption[];
  genre: readonly FacetOption[];
  progress: readonly FacetOption[];
  source: readonly FacetOption[];
  status: readonly FacetOption[];
  type: readonly FacetOption[];
  year: readonly FacetOption[];
}

export const emptyLibraryFilters: LibraryFiltersValue = {
  format: {},
  genre: {},
  progress: {},
  query: '',
  sort: 'ADDED_DESC',
  source: {},
  status: {},
  type: {},
  year: {},
};
