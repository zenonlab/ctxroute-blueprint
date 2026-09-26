import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLocalReviewNavigation } from '../../extension/runtime/use-local-review-navigation';
import { reviewDecisionMessageSchema } from '../../extension/runtime/review-messages';

declare global {
  const browser: typeof import('wxt/browser').browser;
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('local Review decision gate', () => {
  it('keeps references pending and serializes same-tick actions until the runtime responds', async () => {
    const references = [{ provider: 'mangaupdates', externalId: '123' }, { provider: 'mangaupdates', externalId: '456' }];
    let release: (response: { ok: boolean; status: string }) => void = () => { throw new Error('Missing pending write.'); };
    const writeDecision = vi.fn(() => new Promise((resolve) => { release = resolve; }));
    const sendMessage = async (message: { type: string }) => {
      if (message.type === 'review.queue.read') return { ok: true, snapshot: { items: [{ id: 'review_synthetic', sourceLabel: 'Synthetic source', title: 'Synthetic river' }], status: 'pending' } };
      if (message.type === 'review.candidates.read') return { ok: true, snapshot: { candidates: [], providerReferences: references, reason: 'AMBIGUOUS', reviewId: 'review_synthetic', revision: 'review-v1-current', state: 'ready', title: 'Synthetic river' } };
      if (message.type === 'review.decision.write') {
        const command = reviewDecisionMessageSchema.parse(message);
        expect(command).toMatchObject({ decision: { kind: 'manual', source: 'id', value: 'mangaupdates:123' }, revision: 'review-v1-current' });
        return writeDecision();
      }
      throw new Error('Unexpected browser message.');
    };
    vi.stubGlobal('browser', { runtime: { sendMessage } });
    const { result } = renderHook(() => useLocalReviewNavigation('library'));
    await waitFor(() => expect(result.current.review?.resolver.item?.providerReferences).toEqual(references));
    expect(result.current.review?.resolver.pending).toBe(false);
    const decision = { kind: 'manual' as const, revision: 'review-v1-current', source: 'id' as const, value: 'mangaupdates:123' };
    act(() => {
      result.current.review?.resolver.onSubmitDecision(decision);
      result.current.review?.resolver.onSubmitDecision(decision);
    });
    expect(writeDecision).toHaveBeenCalledTimes(1);
    expect(result.current.review?.resolver.busy).toBe(true);
    await act(async () => release({ ok: true, status: 'pending' }));
    await waitFor(() => expect(result.current.review?.resolver.busy).toBe(false));
    await waitFor(() => expect(result.current.review?.resolver.item?.providerReferences).toEqual(references));
    expect(result.current.review?.resolver.pending).toBe(true);
    writeDecision.mockRejectedValueOnce(new Error('transport unavailable'));
    act(() => result.current.review?.resolver.onSubmitDecision(decision));
    await waitFor(() => expect(result.current.review?.resolver.state).toBe('error'));
    expect(result.current.review?.resolver.busy).toBe(false);
    expect(writeDecision).toHaveBeenCalledTimes(2);
  });
});
