import type { BookmarkImportPort, BookmarkInventoryCursor, BookmarkInventoryFrame, BookmarkInventorySlice, BookmarkRecord } from '@tobirink/application';

export interface WebExtensionBookmarkNode {
  children?: readonly WebExtensionBookmarkNode[];
  id: string;
  index?: number;
  title: string;
  url?: string;
}

interface WebExtensionBookmarksApi {
  getChildren(id: string): Promise<readonly WebExtensionBookmarkNode[]>;
}

const defaultRootIds = ['0', 'root________'] as const;

function freezeCursor(rootId: string, frames: readonly BookmarkInventoryFrame[]): BookmarkInventoryCursor {
  return Object.freeze({
    frames: Object.freeze(frames.map((frame) => Object.freeze({ ...frame, folderPath: Object.freeze([...frame.folderPath]) }))),
    rootId,
  });
}

export class WebExtensionBookmarkImportAdapter implements BookmarkImportPort {
  constructor(private readonly bookmarks: WebExtensionBookmarksApi, private readonly rootIds: readonly string[] = defaultRootIds) {}

  private async resolveRoot(): Promise<string> {
    for (const rootId of this.rootIds) {
      try { await this.bookmarks.getChildren(rootId); return rootId; } catch { /* try the next browser root */ }
    }
    throw new Error('BOOKMARK_ROOT_UNAVAILABLE');
  }

  async readBookmarkBatch(cursor?: BookmarkInventoryCursor, limit = 100): Promise<BookmarkInventorySlice> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Bookmark batch limit must be between 1 and 100.');
    const rootId = cursor?.rootId ?? await this.resolveRoot();
    const frames: BookmarkInventoryFrame[] = cursor === undefined
      ? [{ folderId: rootId, folderPath: [], nextChildIndex: 0 }]
      : cursor.frames.map((frame) => ({ ...frame, folderPath: [...frame.folderPath] }));
    const records: BookmarkRecord[] = [];
    const cachedChildren = new Map<string, readonly WebExtensionBookmarkNode[]>();

    while (frames.length > 0 && records.length < limit) {
      const frame = frames.at(-1);
      if (frame === undefined) break;
      let children = cachedChildren.get(frame.folderId);
      if (children === undefined) {
        children = await this.bookmarks.getChildren(frame.folderId);
        cachedChildren.set(frame.folderId, children);
      }
      const node = children[frame.nextChildIndex];
      if (node === undefined) { frames.pop(); continue; }
      frame.nextChildIndex += 1;
      const indexedOrder = node.index;
      const order = indexedOrder !== undefined && Number.isInteger(indexedOrder) && indexedOrder >= 0 ? indexedOrder : frame.nextChildIndex - 1;
      if (node.url !== undefined) {
        records.push(Object.freeze({ bookmarkId: node.id, folderPath: Object.freeze([...frame.folderPath]), order, title: node.title, url: node.url }));
      } else {
        const folderTitle = node.title.trim();
        frames.push({ folderId: node.id, folderPath: folderTitle ? [...frame.folderPath, folderTitle] : [...frame.folderPath], nextChildIndex: 0 });
      }
    }

    const complete = frames.length === 0;
    const slice = { complete, records: Object.freeze(records) };
    return complete ? Object.freeze(slice) : Object.freeze({ ...slice, cursor: freezeCursor(rootId, frames) });
  }
}
