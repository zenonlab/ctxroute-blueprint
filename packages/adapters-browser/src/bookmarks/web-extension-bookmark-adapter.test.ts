import { describe, expect, it } from 'vitest';
import { WebExtensionBookmarkImportAdapter } from './web-extension-bookmark-adapter';

describe('WebExtensionBookmarkImportAdapter', () => {
  it('B-01 walks getChildren in bounded slices while preserving folder paths and sibling order', async () => {
    const tree = new Map<string, readonly { id: string; index?: number; title: string; url?: string }[]>([
      ['0', [{ id: 'folder-manga', title: ' Manga ' }]],
      ['folder-manga', [
        { id: 'bookmark-a', index: 2, title: ' Frieren ', url: 'https://reader.example/frieren' },
        { id: 'bookmark-b', title: 'Interne', url: 'chrome://bookmarks' },
      ]],
    ]);
    const adapter = new WebExtensionBookmarkImportAdapter({
      getChildren: async (id) => tree.get(id) ?? [],
    });

    const first = await adapter.readBookmarkBatch(undefined, 1);
    expect(first.complete).toBe(false);
    expect(first.records).toEqual([
      { bookmarkId: 'bookmark-a', folderPath: ['Manga'], order: 2, title: ' Frieren ', url: 'https://reader.example/frieren' },
    ]);
    await expect(adapter.readBookmarkBatch(first.cursor, 1)).resolves.toEqual({ complete: false, cursor: { frames: [{ folderId: '0', folderPath: [], nextChildIndex: 1 }, { folderId: 'folder-manga', folderPath: ['Manga'], nextChildIndex: 2 }], rootId: '0' }, records: [
      { bookmarkId: 'bookmark-b', folderPath: ['Manga'], order: 1, title: 'Interne', url: 'chrome://bookmarks' },
    ] });
  });

  it('returns immutable records without browser globals', async () => {
    const adapter = new WebExtensionBookmarkImportAdapter({
      getChildren: async () => [{ id: 'bookmark-a', title: 'A', url: 'https://example.test/a' }],
    });
    const slice = await adapter.readBookmarkBatch();
    expect(Object.isFrozen(slice.records)).toBe(true);
    expect(Object.isFrozen(slice.records[0]?.folderPath)).toBe(true);
  });

  it('uses the Firefox root when the Chromium root is unavailable', async () => {
    const adapter = new WebExtensionBookmarkImportAdapter({ getChildren: async (id) => {
      if (id === '0') throw new Error('unknown root');
      return [];
    } });
    await expect(adapter.readBookmarkBatch()).resolves.toEqual({ complete: true, records: [] });
  });
});
