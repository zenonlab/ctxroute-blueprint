import { describe, expect, it, vi } from 'vitest';
import { HttpReviewCandidateAdapter, reviewCandidateResponseByteLimit } from './http-review-candidate-adapter';

const work = { id: 'work_frieren', mediaKind: 'manga', preferredTitle: 'Frieren', revision: 2 };
type ReviewCandidateResponseFixture =
  | { error: string }
  | { items: Array<typeof work> }
  | { work: typeof work }
  | { work: typeof work & { privateUrl: string } }
  | Record<never, never>;

const json = (body: ReviewCandidateResponseFixture, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(body), {
  headers: new Headers({ 'Content-Type': 'application/json', ...Object.fromEntries(new Headers(headers)) }),
  status,
});

describe('HttpReviewCandidateAdapter', () => {
  it('uses only the owned reference and title routes with injected fetch', async () => {
    const fetcher = vi.fn(async () => json({ work }));
    const adapter = new HttpReviewCandidateAdapter('https://api.tobirink.test', fetcher);
    await expect(adapter.findCandidates({
      kind: 'reference',
      limit: 6,
      reference: { externalId: '154587', provider: 'anilist' },
    })).resolves.toEqual([{
      externalReferences: [{ externalId: '154587', provider: 'anilist' }],
      id: 'work_frieren',
      mediaKind: 'manga',
      preferredTitle: 'Frieren',
    }]);
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.tobirink.test/v1/catalogue/resolve?provider=anilist&externalId=154587',
      expect.objectContaining({ credentials: 'omit', method: 'GET', redirect: 'error', referrerPolicy: 'no-referrer' }),
    );

    fetcher.mockResolvedValueOnce(json({ items: [work] }));
    await expect(adapter.findCandidates({ kind: 'title', limit: 1, title: ' Frieren ' })).resolves.toHaveLength(1);
    expect(fetcher).toHaveBeenLastCalledWith(
      'https://api.tobirink.test/v1/catalogue/search?title=Frieren&limit=1',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('rejects unsafe origins and query values before fetch', async () => {
    const fetcher = vi.fn(async () => json({ items: [] }));
    for (const origin of ['http://api.tobirink.test', 'https://user@api.tobirink.test', 'https://api.tobirink.test/v1', 'https://api.tobirink.test?x=1']) {
      expect(() => new HttpReviewCandidateAdapter(origin, fetcher)).toThrow(/HTTPS origin/u);
    }
    const adapter = new HttpReviewCandidateAdapter('https://api.tobirink.test', fetcher);
    await expect(adapter.findCandidates({ kind: 'title', limit: 7, title: 'Frieren' })).rejects.toThrow(/between 1 and 6/u);
    await expect(adapter.findCandidates({ kind: 'title', limit: 1, title: ' ' })).rejects.toThrow(/title/u);
    await expect(adapter.findCandidates({ kind: 'title', limit: 1, title: 'Frieren\nsecret' })).rejects.toThrow(/title/u);
    await expect(adapter.findCandidates({ kind: 'reference', limit: 1, reference: { externalId: '../private', provider: 'reader' } })).rejects.toThrow(/reference/u);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('fails closed for invalid, oversized and unsuccessful responses', async () => {
    const fetcher = vi.fn(async () => json({ error: 'not-found' }, 404));
    const adapter = new HttpReviewCandidateAdapter('https://api.tobirink.test', fetcher);
    const reference = { kind: 'reference' as const, limit: 1, reference: { externalId: '154587', provider: 'anilist' } };
    await expect(adapter.findCandidates(reference)).resolves.toEqual([]);

    fetcher.mockResolvedValueOnce(json({ work: { ...work, privateUrl: 'https://private.example' } }));
    await expect(adapter.findCandidates(reference)).rejects.toThrow(/Invalid Review candidate response/u);
    fetcher.mockResolvedValueOnce(new Response('{', { headers: { 'Content-Type': 'application/json' } }));
    await expect(adapter.findCandidates(reference)).rejects.toThrow(/Invalid Review candidate response/u);
    fetcher.mockResolvedValueOnce(json({ items: [work, work] }));
    await expect(adapter.findCandidates({ kind: 'title', limit: 1, title: 'Frieren' })).rejects.toThrow(/exceeds its limit/u);
    fetcher.mockResolvedValueOnce(new Response('{}', { headers: { 'Content-Type': 'text/plain' } }));
    await expect(adapter.findCandidates(reference)).rejects.toThrow(/must be JSON/u);
    fetcher.mockResolvedValueOnce(json({}, 200, { 'Content-Length': String(reviewCandidateResponseByteLimit + 1) }));
    await expect(adapter.findCandidates(reference)).rejects.toThrow(/byte limit/u);
    fetcher.mockResolvedValueOnce(json({ error: 'down' }, 503));
    await expect(adapter.findCandidates(reference)).rejects.toThrow(/status 503/u);
  });
});
