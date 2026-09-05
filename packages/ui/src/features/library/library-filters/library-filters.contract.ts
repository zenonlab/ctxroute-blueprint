import type { FacetOption, FacetSelection } from '../../../components/facet-select';

export const libraryFiltersVariants = ['library'] as const;
export const libraryFiltersStates = ['default', 'filtered', 'disabled'] as const;

export type LibraryFiltersVariant = (typeof libraryFiltersVariants)[number];
export type LibraryFiltersState = (typeof libraryFiltersStates)[number];

export interface LibraryFiltersValue {
  query: string;
  progress: FacetSelection;
  status: FacetSelection;
  type: FacetSelection;
}

export interface LibraryFilterOptions {
  progress: readonly FacetOption[];
  status: readonly FacetOption[];
  type: readonly FacetOption[];
}

export const emptyLibraryFilters: LibraryFiltersValue = {
  progress: {},
  query: '',
  status: {},
  type: {},
};
