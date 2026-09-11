import type { WorkId } from '@tobirink/domain';

export type WebBridgeAvailability = 'connected' | 'extension-missing' | 'reconnecting' | 'incompatible';

export interface WebBootstrapSnapshot {
  availability: WebBridgeAvailability;
  generation: number;
  libraryCount: number;
  pendingReviewCount: number;
  protocolVersion: 3;
}

export interface WebLibraryQuery {
  cursor?: string;
  facet?: 'all' | 'anime' | 'manga';
  facets?: WebLibraryFacetSelection;
  limit: number;
  search?: string;
  sort?: WebLibrarySort;
  workId?: WorkId;
}

export type WebLibraryFacetState = 'include' | 'exclude';
export type WebLibraryFacetName = 'format' | 'genre' | 'progress' | 'source' | 'status' | 'type' | 'year';
export type WebLibraryFacetSelection = Readonly<Partial<Record<WebLibraryFacetName, Readonly<Record<string, WebLibraryFacetState>>>>>;
export type WebLibrarySort = 'ADDED_DESC' | 'PROGRESS_DESC' | 'POPULARITY_DESC' | 'TITLE_ASC' | 'TITLE_DESC' | 'YEAR_DESC';

export interface WebLibraryPage {
  cursor?: string;
  facets: Readonly<Record<WebLibraryFacetName, readonly Readonly<{ count: number; label: string; value: string }>[]>>;
  hasMore: boolean;
  items: readonly WebLibraryItem[];
  query: WebLibraryQuery;
  statistics: Readonly<{ completed: number; inProgress: number; knownMetadata: number; notStarted: number; total: number }>;
  total: number;
  truncated: boolean;
}

export interface WebLibraryItem {
  canonicalUrl?: string;
  chapterCount?: number;
  coverAttribution?: string;
  coverFallbackUrl?: string;
  coverUrl?: string;
  editorialStatus?: 'UPCOMING' | 'ONGOING' | 'HIATUS' | 'COMPLETED' | 'CANCELLED' | 'UNKNOWN';
  endYear?: number;
  episodeCount?: number;
  format?: string;
  genres?: readonly string[];
  mediaKind: 'anime' | 'manga';
  popularity?: Readonly<{ kind: 'MEMBERS' | 'RANK'; value: number }>;
  progress?: Readonly<{ kind: 'episode' | 'chapter' | 'volume'; maximum?: number; value: number }>;
  progressLabel?: string;
  provider?: string;
  sourceUrl?: string;
  startYear?: number;
  title: string;
  titleVariants?: readonly Readonly<{ language?: string; title: string }>[];
  volumeCount?: number;
  workId: WorkId;
}

export interface WebAgendaPeriod {
  entries: readonly WebAgendaEntry[];
  from: string;
  to: string;
}

export interface WebAgendaEntry {
  availability: 'official' | 'confirmed' | 'estimated';
  kind: 'anime' | 'manga';
  occursAt: string;
  releaseLabel: string;
  sourceLabel?: string;
  sourceUrl?: string;
  title: string;
  workId: WorkId;
}

export interface WebReviewSnapshot {
  candidates: readonly WebReviewCandidate[];
  context: 'local' | 'public';
  reviewId?: string;
  revision?: string;
  title?: string;
}

export interface WebReviewCandidate {
  candidateId: string;
  mediaKind: 'anime' | 'manga';
  sourceUrl: string;
  title: string;
  workId?: WorkId;
}

export interface WebReviewDecisionCommand {
  decision: { kind: 'candidate'; workId: WorkId } | { kind: 'manual'; source: 'id' | 'url'; value: string } | { kind: 'none' };
  reviewId: string;
  revision: string;
}

export interface WebBridgePort {
  connect(): Promise<WebBootstrapSnapshot>;
  readAgenda(input: { from: string; to: string }): Promise<WebAgendaPeriod>;
  readLibrary(query: WebLibraryQuery): Promise<WebLibraryPage>;
  readReview(): Promise<WebReviewSnapshot>;
  writeReviewDecision(command: WebReviewDecisionCommand): Promise<WebReviewSnapshot>;
}
