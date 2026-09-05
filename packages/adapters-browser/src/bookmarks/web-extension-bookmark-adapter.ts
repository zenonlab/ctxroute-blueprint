import type { BookmarkImportPort, BookmarkRecord } from '@tobirink/application';

export interface WebExtensionBookmarkNode {
  children?: readonly WebExtensionBookmarkNode[];
  id: string;
  index?: number;
  title: string;
  url?: string;
}

interface WebExtensionBookmarksApi {
  getTree(): Promise<readonly WebExtensionBookmarkNode[]>;
}

function flattenBookmarks(
  nodes: readonly WebExtensionBookmarkNode[],
  parentPath: readonly string[],
  records: BookmarkRecord[],
): void {
  nodes.forEach((node, position) => {
    const indexedOrder = node.index;
    const order = indexedOrder !== undefined && Number.isInteger(indexedOrder) && indexedOrder >= 0 ? indexedOrder : position;
    if (node.url !== undefined) {
      records.push(Object.freeze({
        bookmarkId: node.id,
        folderPath: Object.freeze([...parentPath]),
        order,
        title: node.title,
        url: node.url,
      }));
      return;
    }

    const folderTitle = node.title.trim();
    const path = folderTitle ? [...parentPath, folderTitle] : parentPath;
    if (node.children) flattenBookmarks(node.children, path, records);
  });
}

export class WebExtensionBookmarkImportAdapter implements BookmarkImportPort {
  constructor(private readonly bookmarks: WebExtensionBookmarksApi) {}

  async importBookmarks(): Promise<readonly BookmarkRecord[]> {
    const records: BookmarkRecord[] = [];
    flattenBookmarks(await this.bookmarks.getTree(), [], records);
    return Object.freeze(records);
  }
}
