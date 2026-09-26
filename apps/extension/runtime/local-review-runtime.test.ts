import { describe, expect, it, vi } from 'vitest';
import { importFavoriteSources, readLocalReviewCandidates } from '@tobirink/application';
import type { PublicDiscoveryRequestClientPort } from '@tobirink/application';
import { MemoryStoragePort } from '@tobirink/contracts';
import { createReview, libraryId, reviewId } from '@tobirink/domain';
import { readLocalReviewCandidateSnapshot, writeLocalReviewDecision } from './local-review-runtime';
import { reviewCandidatesResponseSchema } from './review-messages';

async function fixture() {
  const storage = new MemoryStoragePort();
  const library = libraryId('library_manual');
  await importFavoriteSources([{ bookmarkId: '42', folderPath: [], order: 0, state: 'eligible', title: 'Synthetic voyager', url: 'https://reader.example/manga/voyager' }], storage, '2026-09-08T00:00:00.000Z');
  const [source] = await storage.listFavoriteSources({ limit: 1 });
  if (!source) throw new Error('Expected source.');
  const review = createReview({ id: reviewId('review_manual'), reason: 'NOT_FOUND', sourceLabel: source.url, status: 'pending', title: source.title });
  const terminalSource = { ...source, resolution: { kind: 'REVIEW_REQUIRED' as const, reason: 'NOT_FOUND' as const }, reviewId: review.id };
  await storage.putReview(review);
  await storage.putFavoriteSource(terminalSource);
  const snapshot = await readLocalReviewCandidates(storage, { libraryId: library, reviewId: review.id });
  const candidate = { canonicalUrl: 'https://anilist.co/anime/123', externalId: '123', mediaKind: 'ANIME' as const, preSerialization: false, provider: 'anilist' as const, titles: ['Synthetic different title'] };
  const resolveOrRequest = vi.fn<PublicDiscoveryRequestClientPort['resolveOrRequest']>();
  resolveOrRequest.mockResolvedValue({ profile: { candidate, references: [{ externalId: '123', provider: 'anilist' }], workId: 'work_public_manual123' }, state: 'VERIFIED', verifiedAt: '2026-09-15T00:10:00.000Z' });
  const discovery: PublicDiscoveryRequestClientPort = { resolveOrRequest };
  return { candidate, discovery, library, resolveOrRequest, review, snapshot, source: terminalSource, storage };
}

describe('Manual Review public discovery', () => {
  it('verifies a selected remote ambiguity reference through the existing manual action', async () => {
    const { discovery, library, resolveOrRequest, review, source, storage } = await fixture();
    const references = [{ provider: 'anilist' as const, externalId: '123' }, { provider: 'anilist' as const, externalId: '456' }];
    await storage.putReview({ ...review, reason: 'AMBIGUOUS' });
    await storage.putFavoriteSource({ ...source, resolution: { kind: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS' } });
    await storage.putFavoriteReviewCandidateSet({ candidates: [], references, digest: 'remote-ambiguity', totalCandidates: 2, provenance: 'public-discovery', recordedAt: '2026-09-08T00:00:00.000Z', reviewId: review.id });
    const snapshot = await readLocalReviewCandidates(storage, { libraryId: library, reviewId: review.id });
    expect(snapshot).toMatchObject({ candidates: [], providerReferences: references, state: 'ready' });
    const response = reviewCandidatesResponseSchema.parse({ ok: true, snapshot: await readLocalReviewCandidateSnapshot(storage, library, review.id) });
    expect(response).toMatchObject({ ok: true, snapshot: { candidates: [], providerReferences: references, reason: 'AMBIGUOUS', state: 'ready' } });
    const selected = snapshot.providerReferences?.[0];
    if (selected === undefined) throw new Error('Expected a comparable public reference.');
    const command = { decision: { kind: 'manual' as const, source: 'id' as const, value: `${selected.provider}:${selected.externalId}` }, reviewId: review.id, revision: snapshot.revision };
    resolveOrRequest.mockResolvedValueOnce({ state: 'PENDING', retryAt: '2026-09-15T00:10:00.000Z' });
    await expect(writeLocalReviewDecision(storage, library, command, discovery)).resolves.toEqual({ status: 'pending' });
    expect(await storage.listWorks({ limit: 100 })).toEqual([]);
    expect(await storage.getReview(review.id)).toMatchObject({ reason: 'AMBIGUOUS', status: 'pending' });
    await expect(writeLocalReviewDecision(storage, library, command, discovery)).resolves.toMatchObject({ decisionOrigin: 'human', status: 'resolved' });
    expect(resolveOrRequest).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ explicitProviderReference: selected }));
    expect(await storage.listWorks({ limit: 100 })).toHaveLength(1);
    await expect(writeLocalReviewDecision(storage, library, command, discovery)).rejects.toThrow(/stale/u);
    expect(resolveOrRequest).toHaveBeenCalledTimes(2);
  });
  it.each([{ source: 'id' as const, value: 'anilist:123' }, { source: 'url' as const, value: 'https://anilist.co/anime/123' }])('commits an explicit $source only from a verified D1 profile', async (manual) => {
    const { discovery, library, resolveOrRequest, review, snapshot, source, storage } = await fixture();
    const result = await writeLocalReviewDecision(storage, library, { decision: { kind: 'manual', ...manual }, reviewId: review.id, revision: snapshot.revision }, discovery);
    expect(resolveOrRequest).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u) }), expect.objectContaining({ explicitProviderReference: { externalId: '123', provider: 'anilist' } }));
    expect(result).toMatchObject({ decisionOrigin: 'human', status: 'resolved' });
    if (!('matchedWorkId' in result)) throw new Error('Expected a resolved Review.');
    expect(await storage.getFavoriteSource(source.id)).toMatchObject({ matchedWorkId: result.matchedWorkId, resolution: { kind: 'RESOLVED' } });
  });

  it('keeps the Review pending while GitHub has not published the manual identity', async () => {
    const { discovery, library, resolveOrRequest, review, snapshot, storage } = await fixture();
    resolveOrRequest.mockResolvedValueOnce({ retryAt: '2026-09-15T00:10:00.000Z', state: 'PENDING' });
    await expect(writeLocalReviewDecision(storage, library, { decision: { kind: 'manual', source: 'id', value: 'anilist:123' }, reviewId: review.id, revision: snapshot.revision }, discovery)).resolves.toEqual({ status: 'pending' });
    expect(await storage.getReview(review.id)).toEqual(review);
    expect(await storage.listWorks({ limit: 100 })).toEqual([]);
  });

  it('rechecks the private revision after hydration and publishes no partial work', async () => {
    const { candidate, discovery, library, resolveOrRequest, review, snapshot, source, storage } = await fixture();
    resolveOrRequest.mockImplementationOnce(async () => {
      await storage.putFavoriteSource({ ...source, title: 'Changed while hydrating' });
      return { profile: { candidate, references: [{ externalId: '123', provider: 'anilist' as const }], workId: 'work_public_manual123' }, state: 'VERIFIED' as const, verifiedAt: '2026-09-15T00:10:00.000Z' };
    });
    await expect(writeLocalReviewDecision(storage, library, { decision: { kind: 'manual', source: 'id', value: 'anilist:123' }, reviewId: review.id, revision: snapshot.revision }, discovery)).rejects.toThrow(/conflict/u);
    expect(await storage.getReview(review.id)).toEqual(review);
    expect(await storage.listWorks({ limit: 100 })).toEqual([]);
  });

  it('leaves NOT_FOUND actionable during a provider outage', async () => {
    const { discovery, library, resolveOrRequest, review, snapshot, storage } = await fixture();
    resolveOrRequest.mockRejectedValueOnce(new Error('public discovery timeout'));
    await expect(writeLocalReviewDecision(storage, library, { decision: { kind: 'manual', source: 'id', value: 'anilist:123' }, reviewId: review.id, revision: snapshot.revision }, discovery)).rejects.toThrow('public discovery timeout');
    expect(await storage.getReview(review.id)).toEqual(review);
    expect(await storage.listWorks({ limit: 100 })).toEqual([]);
  });

  it('rejects a verified profile that omits the exact requested reference', async () => {
    const { candidate, discovery, library, resolveOrRequest, review, snapshot, storage } = await fixture();
    resolveOrRequest.mockResolvedValueOnce({ profile: { candidate: { ...candidate, externalId: '999' }, references: [{ externalId: '999', provider: 'anilist' }], workId: 'work_public_other999' }, state: 'VERIFIED', verifiedAt: '2026-09-15T00:10:00.000Z' });
    await expect(writeLocalReviewDecision(storage, library, { decision: { kind: 'manual', source: 'id', value: 'anilist:123' }, reviewId: review.id, revision: snapshot.revision }, discovery)).rejects.toThrow(/unavailable/u);
    expect(await storage.getReview(review.id)).toEqual(review);
  });
});
