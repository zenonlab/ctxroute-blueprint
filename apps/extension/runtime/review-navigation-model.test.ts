import { describe, expect, it, vi } from 'vitest';
import { createLocalReviewNavigation } from './review-navigation-model';

function callbacks() {
  return { onIndexChange: vi.fn(), onRetry: vi.fn(), onSubmitDecision: vi.fn() };
}

const firstCandidates = {
  snapshot: {
    candidates: [{ candidateId: 'work_candidate1', href: 'https://catalogue.example/one', mediaType: 'anime' as const, provider: 'local', providerId: 'one', title: 'One' }],
    reviewId: 'review_source1',
    revision: 'review-v1-current',
    state: 'ready' as const,
    title: 'One',
  },
  state: 'ready' as const,
};

describe('createLocalReviewNavigation', () => {
  it('carries comparable references to the resolver without manufacturing candidates', () => {
    const providerReferences = [{ provider: 'mangaupdates' as const, externalId: '123' }, { provider: 'mangaupdates' as const, externalId: '456' }];
    const navigation = createLocalReviewNavigation({ state: 'ready', snapshot: { items: [{ id: 'review_source1', sourceLabel: 'Source', title: 'Synthetic ambiguity' }], status: 'pending' } }, 0, callbacks(), {
      state: 'ready', snapshot: { ...firstCandidates.snapshot, candidates: [], reason: 'AMBIGUOUS', providerReferences },
    });
    expect(navigation.resolver.item).toMatchObject({ candidates: [], providerReferences, revision: firstCandidates.snapshot.revision });
  });
  it('maps loading, errors and an empty local queue without fixtures', () => {
    const actions = callbacks();
    expect(createLocalReviewNavigation({ state: 'loading' }, 0, actions).resolver.state).toBe('loading');
    expect(createLocalReviewNavigation({ state: 'error' }, 0, actions).resolver.state).toBe('error');
    expect(createLocalReviewNavigation({ snapshot: { items: [], status: 'pending' }, state: 'ready' }, 0, actions))
      .toMatchObject({ count: 0, resolver: { state: 'empty' } });
  });

  it('maps the selected local Review and navigates without submitting a decision', () => {
    const actions = callbacks();
    const navigation = createLocalReviewNavigation({
      snapshot: {
        items: [
          { id: 'review_source1', sourceLabel: 'https://reader.example/one', title: 'One' },
          { id: 'review_source2', sourceLabel: 'browser folder', title: 'Two' },
        ],
        status: 'pending',
      },
      state: 'ready',
    }, 0, actions, firstCandidates);

    expect(navigation).toMatchObject({
      count: 2,
      resolver: {
        canNext: true,
        canPrevious: false,
        item: { id: 'review_source1', position: 1, sourceUrl: 'https://reader.example/one', total: 2 },
        state: 'ready',
      },
    });
    navigation.resolver.onNext();
    expect(actions.onIndexChange).toHaveBeenCalledWith(1);
    expect(actions.onSubmitDecision).not.toHaveBeenCalled();

    const second = createLocalReviewNavigation({
      snapshot: {
        items: [
          { id: 'review_source1', sourceLabel: 'https://reader.example/one', title: 'One' },
          { id: 'review_source2', sourceLabel: 'browser folder', title: 'Two' },
        ],
        status: 'pending',
      },
      state: 'ready',
    }, 1, actions, {
      snapshot: { candidates: [], reviewId: 'review_source2', revision: 'review-v1-second', state: 'partial', title: 'Two' },
      state: 'ready',
    });
    expect(second.resolver.item).not.toHaveProperty('sourceUrl');
  });
});
