export type BookmarkMutation = Readonly<{
  bookmarkId: string;
  kind: 'changed' | 'created' | 'moved' | 'removed';
}>;

interface BookmarkCreatedNode { readonly id: string }
interface BookmarkChangeInfo { readonly title?: string; readonly url?: string }
interface BookmarkMoveInfo { readonly index: number; readonly parentId: string }
interface BookmarkRemoveInfo { readonly index: number; readonly parentId: string }
interface BookmarkEvent<TListener> { addListener(listener: TListener): void }

export interface WebExtensionBookmarkEventsApi {
  readonly onChanged: BookmarkEvent<(id: string, changeInfo: BookmarkChangeInfo) => void>;
  readonly onCreated: BookmarkEvent<(id: string, node: BookmarkCreatedNode) => void>;
  readonly onMoved: BookmarkEvent<(id: string, moveInfo: BookmarkMoveInfo) => void>;
  readonly onRemoved: BookmarkEvent<(id: string, removeInfo: BookmarkRemoveInfo) => void>;
}

export class WebExtensionBookmarkEventAdapter {
  constructor(private readonly bookmarks: WebExtensionBookmarkEventsApi) {}

  subscribe(listener: (mutation: BookmarkMutation) => void): void {
    this.bookmarks.onCreated.addListener((id) => listener(Object.freeze({ bookmarkId: id, kind: 'created' })));
    this.bookmarks.onChanged.addListener((id) => listener(Object.freeze({ bookmarkId: id, kind: 'changed' })));
    this.bookmarks.onMoved.addListener((id) => listener(Object.freeze({ bookmarkId: id, kind: 'moved' })));
    this.bookmarks.onRemoved.addListener((id) => listener(Object.freeze({ bookmarkId: id, kind: 'removed' })));
  }
}
