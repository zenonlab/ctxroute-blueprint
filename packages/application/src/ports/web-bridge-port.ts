import type { WorkId } from '@tobirink/domain';

export type WebBridgeAvailability = 'connected' | 'extension-missing' | 'reconnecting' | 'incompatible';

export interface WebBootstrapSnapshot {
  availability: WebBridgeAvailability;
  generation: number;
  libraryCount: number;
  pendingReviewCount: number;
  protocolVersion: 2;
}

export interface WebLibraryQuery {
  cursor?: string;
  facet?: 'all' | 'anime' | 'manga';
  limit: number;
  search?: string;
}

export interface WebLibraryPage {
  cursor?: string;
  hasMore: boolean;
  items: readonly WebLibraryItem[];
  query: WebLibraryQuery;
}

export interface WebLibraryItem {
  coverUrl?: string;
  mediaKind: 'anime' | 'manga';
  progressLabel?: string;
  title: string;
  workId: WorkId;
}

export interface WebAgendaPeriod {
  certainty: 'confirmed' | 'estimated' | 'unknown';
  entries: readonly WebAgendaEntry[];
  from: string;
  provenance: 'local' | 'public-catalogue' | 'mixed';
  to: string;
}

export interface WebAgendaEntry {
  date?: string;
  kind: 'anime' | 'manga';
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
