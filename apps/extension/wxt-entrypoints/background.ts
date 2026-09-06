import { importFavoriteSources, parseOrganizerConfiguration, readAgendaPeriod, readLibraryPage, readOrganizerPreview, readPopupContext, readReviewQueue, saveOrganizerConfiguration } from '@tobirink/application';
import {
  normalizeBookmarks,
  WebExtensionBookmarkImportAdapter,
  WebExtensionPageContextAdapter,
  WebExtensionPopupContinuationCacheAdapter,
} from '@tobirink/adapters-browser';
import { libraryId, workId } from '@tobirink/domain';
import { createExtensionLocalStorage } from '../runtime/local-storage';
import { extensionMessageSchema } from '../runtime/messages';

const primaryLibraryId = libraryId('library_primary');

export default defineBackground({
  type: 'module',
  main() {
    const pageContext = new WebExtensionPageContextAdapter(browser.tabs);
    const cache = new WebExtensionPopupContinuationCacheAdapter(browser.storage.local);
    const bookmarks = new WebExtensionBookmarkImportAdapter(browser.bookmarks);
    const privateStorage = createExtensionLocalStorage();
    browser.runtime.onInstalled.addListener(async () => {
      await privateStorage.ensureReady();
      const favorites = normalizeBookmarks(await bookmarks.importBookmarks());
      await importFavoriteSources(favorites, privateStorage.storage, new Date().toISOString());
    });
    browser.runtime.onMessage.addListener(async (value, sender) => {
      if (sender.id && sender.id !== browser.runtime.id) return { error: 'invalid-sender', ok: false };
      const parsed = extensionMessageSchema.safeParse(value);
      if (!parsed.success) return { error: 'invalid-message', ok: false };
      if (parsed.data.type === 'health.check') return { ok: true, version: 1 };
      if (parsed.data.type === 'review.queue.read') {
        try {
          await privateStorage.ensureReady();
          return { ok: true, snapshot: await readReviewQueue(privateStorage.storage) };
        } catch {
          return { error: 'review-queue-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'library.page.read') {
        try {
          await privateStorage.ensureReady();
          const input = parsed.data.afterId
            ? { afterId: workId(parsed.data.afterId), libraryId: primaryLibraryId }
            : { libraryId: primaryLibraryId };
          const snapshot = await readLibraryPage(privateStorage.storage, input);
          return {
            ok: true,
            snapshot: {
              items: snapshot.items.map((work) => ({
                id: work.id,
                mediaType: work.mediaKind,
                source: work.externalReferences[0]?.provider ?? work.mediaKind,
                title: work.preferredTitle,
              })),
              missingWorkIds: snapshot.missingWorkIds,
              nextCursor: snapshot.nextCursor,
            },
          };
        } catch {
          return { error: 'library-page-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'agenda.period.read') {
        try {
          await privateStorage.ensureReady();
          const snapshot = await readAgendaPeriod(privateStorage.storage, parsed.data);
          return {
            ok: true,
            snapshot: {
              items: snapshot.items.map(({ entry, source, work }) => {
                const item = {
                  availability: entry.availability,
                  id: entry.id,
                  mediaType: work.mediaKind,
                  occursAt: entry.occursAt,
                  release: entry.releaseLabel,
                  source: work.externalReferences[0]?.provider ?? work.mediaKind,
                  title: work.preferredTitle,
                  workId: work.id,
                };
                return source ? { ...item, sourceUrl: source.url } : item;
              }),
              missingWorkIds: snapshot.missingWorkIds,
            },
          };
        } catch {
          return { error: 'agenda-period-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'organizer.configuration.read') {
        try {
          await privateStorage.ensureReady();
          return { configuration: await privateStorage.storage.getOrganizerConfiguration(), ok: true };
        } catch {
          return { error: 'organizer-configuration-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'organizer.configuration.write') {
        try {
          await privateStorage.ensureReady();
          const configuration = await saveOrganizerConfiguration(privateStorage.storage, parseOrganizerConfiguration(parsed.data.configuration));
          return { configuration, ok: true };
        } catch {
          return { error: 'organizer-configuration-invalid', ok: false };
        }
      }
      if (parsed.data.type === 'organizer.preview.read') {
        try {
          await privateStorage.ensureReady();
          const snapshot = await readOrganizerPreview(privateStorage.storage, parseOrganizerConfiguration(parsed.data.configuration));
          return { ok: true, snapshot };
        } catch {
          return { error: 'organizer-preview-unavailable', ok: false };
        }
      }
      if (parsed.data.type === 'popup.context.read') {
        try {
          await privateStorage.ensureReady();
          const snapshot = await readPopupContext({ cache, now: () => new Date().toISOString(), pageContext, storage: privateStorage.storage });
          return { ok: true, snapshot };
        } catch {
          return { error: 'popup-context-unavailable', ok: false };
        }
      }

      if (parsed.data.target === 'settings') {
        await browser.runtime.openOptionsPage();
      } else {
        await browser.tabs.create({ url: browser.runtime.getURL(`/${parsed.data.target}.html`) });
      }
      return { ok: true };
    });
  },
});
