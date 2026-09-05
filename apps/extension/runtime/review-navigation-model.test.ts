import { describe, expect, it, vi } from 'vitest';
import { createLocalReviewNavigation } from './review-navigation-model';

function callbacks() {
  return { onIndexChange: vi.fn(), onRetry: vi.fn(), onUnavailableDecision: vi.fn() };
}

describe('createLocalReviewNavigation', () => {
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
    }, 0, actions);

    expect(navigation).toMatchObject({
      count: 2,
      resolver: {
        canNext: true,
        canPrevious: false,
        item: { id: 'review_source1', position: 1, sourceUrl: 'https://reader.example/one', total: 2 },
        state: 'partial',
      },
    });
    navigation.resolver.onNext();
    expect(actions.onIndexChange).toHaveBeenCalledWith(1);
    expect(actions.onUnavailableDecision).not.toHaveBeenCalled();

    const second = createLocalReviewNavigation({
      snapshot: {
        items: [
          { id: 'review_source1', sourceLabel: 'https://reader.example/one', title: 'One' },
          { id: 'review_source2', sourceLabel: 'browser folder', title: 'Two' },
        ],
        status: 'pending',
      },
      state: 'ready',
    }, 1, actions);
    expect(second.resolver.item).not.toHaveProperty('sourceUrl');
  });
});
