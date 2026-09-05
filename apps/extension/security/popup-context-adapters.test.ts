import { describe, expect, it } from 'vitest';
import { WebExtensionPageContextAdapter, WebExtensionPopupContinuationCacheAdapter } from '@tobirink/adapters-browser';
import type { PopupContinuationCacheEnvelope } from '@tobirink/application';

describe('popup browser adapters', () => {
  it('reads only the active tab in the current window', async () => {
    const queries: unknown[] = [];
    const adapter = new WebExtensionPageContextAdapter({
      query: async (query) => {
        queries.push(query);
        return [{ title: '  Frieren  ', url: 'https://reader.test/frieren/12' }];
      },
    });
    await expect(adapter.readActivePage()).resolves.toEqual({ title: 'Frieren', url: 'https://reader.test/frieren/12' });
    expect(queries).toEqual([{ active: true, currentWindow: true }]);
  });

  it('rejects internal pages', async () => {
    const adapter = new WebExtensionPageContextAdapter({
      query: async () => [{ title: 'Extensions', url: 'chrome://extensions' }],
    });
    await expect(adapter.readActivePage()).resolves.toBeUndefined();
  });

  it('round-trips the versioned local cache and ignores invalid envelopes', async () => {
    let stored: PopupContinuationCacheEnvelope | undefined;
    const storage = {
      get: async () => ({ 'tobirink.popup-continuations.v1': stored }),
      set: async (value: { 'tobirink.popup-continuations.v1': PopupContinuationCacheEnvelope }) => {
        stored = value['tobirink.popup-continuations.v1'];
      },
    };
    const adapter = new WebExtensionPopupContinuationCacheAdapter(storage);
    await expect(adapter.read()).resolves.toEqual([]);
    await adapter.write([{
      id: 'frieren',
      mediaType: 'Manga',
      source: 'reader.test',
      title: 'Frieren',
      url: 'https://reader.test/frieren/12',
      visitedAt: '2026-09-04T10:00:00.000Z',
    }]);
    await expect(adapter.read()).resolves.toHaveLength(1);
  });
});
