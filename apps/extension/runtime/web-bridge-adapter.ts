import { readAgendaPeriod, readLibraryPage, readReviewQueue } from '@tobirink/application';
import type { StoragePort } from '@tobirink/application';
import { libraryId, workId } from '@tobirink/domain';
import type { LibraryId, WorkId } from '@tobirink/domain';
import type { WebAgendaPeriod, WebBootstrapSnapshot, WebLibraryPage, WebRequest, WebReviewSnapshot } from '@tobirink/contracts/web-bridge';
import { readLocalReviewCandidateSnapshot, writeLocalReviewDecision } from './local-review-runtime';
import type { WebBridgeRequestHandler, WebBridgeValue } from './web-bridge-runtime';

const primaryLibraryId = libraryId('library_primary');
type LibraryReadInput = { afterId?: WorkId; libraryId: LibraryId };

function isoDate(date: Date) { return date.toISOString().slice(0, 10); }

function mapReviewSnapshot(snapshot: Awaited<ReturnType<typeof readLocalReviewCandidateSnapshot>>): WebReviewSnapshot {
  return {
    candidates: snapshot.candidates.map((candidate) => ({ candidateId: candidate.candidateId, mediaKind: candidate.mediaType, sourceUrl: candidate.href, title: candidate.title, workId: workId(candidate.candidateId) })),
    context: 'local',
    reviewId: snapshot.reviewId,
    revision: snapshot.revision,
    title: snapshot.title,
  };
}

export function createWebBridgeRequestHandler(storage: StoragePort): WebBridgeRequestHandler {
  return async (request: WebRequest): Promise<WebBridgeValue> => {
    if (request.type === 'bootstrap.read') {
      const library = await storage.getLibrary(primaryLibraryId);
      const review = await readReviewQueue(storage);
      const snapshot: WebBootstrapSnapshot = { availability: 'connected', generation: 0, libraryCount: library?.workIds.length ?? 0, pendingReviewCount: review.items.length, protocolVersion: 2 };
      return snapshot;
    }
    if (request.type === 'library.read') {
      const libraryInput: LibraryReadInput = { libraryId: primaryLibraryId };
      if (request.query.cursor) libraryInput.afterId = workId(request.query.cursor);
      const page = await readLibraryPage(storage, libraryInput);
      const snapshot: WebLibraryPage = { hasMore: Boolean(page.nextCursor), items: page.items.map((work) => ({ mediaKind: work.mediaKind, title: work.preferredTitle, workId: work.id })), query: request.query };
      if (page.nextCursor) snapshot.cursor = page.nextCursor;
      return snapshot;
    }
    if (request.type === 'agenda.read') {
      const from = `${request.from}T00:00:00.000Z`;
      const to = `${request.to}T23:59:59.999Z`;
      const period = await readAgendaPeriod(storage, { from, to });
      const snapshot: WebAgendaPeriod = { certainty: period.items.every(({ entry }) => entry.availability === 'confirmed' || entry.availability === 'official') ? 'confirmed' : 'estimated', entries: period.items.map(({ entry, work }) => ({ date: isoDate(new Date(entry.occursAt)), kind: work.mediaKind, title: work.preferredTitle, workId: work.id })), from: request.from, provenance: 'local', to: request.to };
      return snapshot;
    }
    if (request.type === 'review.read') {
      const queue = await readReviewQueue(storage);
      if (!queue.items[0]) return { candidates: [], context: 'local' };
      return mapReviewSnapshot(await readLocalReviewCandidateSnapshot(storage, primaryLibraryId, queue.items[0].id));
    }
    if (request.type === 'review.decision.write') {
      await writeLocalReviewDecision(storage, primaryLibraryId, request.command);
      return { candidates: [], context: 'local' };
    }
    return { error: 'unsupported-web-request' };
  };
}
