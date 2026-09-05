import type { BookmarkRecord, ImportableFavorite } from '@tobirink/application';

export function normalizeBookmarks(bookmarks: readonly BookmarkRecord[]): readonly ImportableFavorite[] {
  return bookmarks.map((bookmark) => {
    let state: ImportableFavorite['state'] = 'ignored';
    try {
      const url = new URL(bookmark.url);
      if (url.protocol === 'http:' || url.protocol === 'https:') state = 'eligible';
    } catch { state = 'ignored'; }
    return Object.freeze({ bookmarkId: bookmark.bookmarkId, state, title: bookmark.title.trim() || bookmark.url, url: bookmark.url });
  });
}
