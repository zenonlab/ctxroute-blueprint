import type { FavoriteSource, LibraryId, Progress, ProviderCandidate, Work } from '@tobirink/domain';

export const libraryCatalogueScanLimit = 500;
export const libraryCatalogueReadBatchSize = 100;
export const libraryCataloguePageLimit = 24;
export const libraryFacetLimit = 64;

export type LibraryFacetState = 'include' | 'exclude';
export type LibrarySort = 'ADDED_DESC' | 'PROGRESS_DESC' | 'POPULARITY_DESC' | 'TITLE_ASC' | 'TITLE_DESC' | 'YEAR_DESC';
export type LibraryFacetName = 'format' | 'genre' | 'progress' | 'source' | 'status' | 'type' | 'year';
export type LibraryFacetSelection = Readonly<Partial<Record<LibraryFacetName, Readonly<Record<string, LibraryFacetState>>>>>;

export interface LibraryCatalogueQuery {
  readonly facets?: LibraryFacetSelection;
  readonly libraryId: LibraryId;
  readonly limit?: number;
  readonly offset?: number;
  readonly query?: string;
  readonly sort?: LibrarySort;
}

export interface LibraryCatalogueItem {
  readonly addedOrder: number;
  readonly candidate?: ProviderCandidate;
  readonly id: string;
  readonly mediaKind: 'anime' | 'manga' | 'unknown';
  readonly progress?: Progress;
  readonly source?: FavoriteSource;
  readonly state: 'preparation' | 'ready' | 'retryable' | 'review';
  readonly title: string;
  readonly work?: Work;
}

export interface LibraryFacetOption { readonly count: number; readonly label: string; readonly value: string }
export interface LibraryCatalogueSnapshot {
  readonly facets: Readonly<Record<LibraryFacetName, readonly LibraryFacetOption[]>>;
  readonly items: readonly LibraryCatalogueItem[];
  readonly nextOffset?: number;
  readonly statistics: Readonly<{ completed: number; inProgress: number; knownMetadata: number; notStarted: number; total: number }>;
  readonly total: number;
  readonly truncated: boolean;
}
