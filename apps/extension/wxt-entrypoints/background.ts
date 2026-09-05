import { importFavoriteSources, readPopupContext } from '@tobirink/application';
import {
  normalizeBookmarks,
  WebExtensionBookmarkImportAdapter,
  WebExtensionPageContextAdapter,
  WebExtensionPopupContinuationCacheAdapter,
} from '@tobirink/adapters-browser';
import { createExtensionLocalStorage } from '../runtime/local-storage';
import { extensionMessageSchema } from '../runtime/messages';

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
      if (parsed.data.type === 'popup.context.read') {
        try {
          await privateStorage.ensureReady();
          const snapshot = await readPopupContext({ cache, now: () => new Date().toISOString(), pageContext });
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
