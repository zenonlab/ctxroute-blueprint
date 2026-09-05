import { describe, expect, it } from 'vitest';
import { WebExtensionBookmarkImportAdapter } from './web-extension-bookmark-adapter';

describe('WebExtensionBookmarkImportAdapter', () => {
  it('flattens the browser tree while preserving folder paths and sibling order', async () => {
    const adapter = new WebExtensionBookmarkImportAdapter({
      getTree: async () => [{
        children: [{
          children: [
            { id: 'bookmark-a', index: 2, title: ' Frieren ', url: 'https://reader.example/frieren' },
            { id: 'bookmark-b', title: 'Interne', url: 'chrome://bookmarks' },
          ],
          id: 'folder-manga',
          title: ' Manga ',
        }],
        id: 'root',
        title: '',
      }],
    });

    await expect(adapter.importBookmarks()).resolves.toEqual([
      { bookmarkId: 'bookmark-a', folderPath: ['Manga'], order: 2, title: ' Frieren ', url: 'https://reader.example/frieren' },
      { bookmarkId: 'bookmark-b', folderPath: ['Manga'], order: 1, title: 'Interne', url: 'chrome://bookmarks' },
    ]);
  });

  it('returns immutable records without browser globals', async () => {
    const adapter = new WebExtensionBookmarkImportAdapter({
      getTree: async () => [{ id: 'bookmark-a', title: 'A', url: 'https://example.test/a' }],
    });
    const records = await adapter.importBookmarks();
    expect(Object.isFrozen(records)).toBe(true);
    expect(Object.isFrozen(records[0]?.folderPath)).toBe(true);
  });
});
