import { popupContinuationCacheEnvelopeSchema } from '@tobirink/application';
import type {
  PageContextPort,
  PopupContinuationCacheEnvelope,
  PopupContinuationCachePort,
  PopupContinuationRecord,
} from '@tobirink/application';

const cacheKey = 'tobirink.popup-continuations.v1';
const cacheSchemaVersion = 1;

interface TabsApi {
  query(queryInfo: { active: true; currentWindow: true }): Promise<readonly { title?: string; url?: string }[]>;
}

interface StorageAreaApi {
  get(key: typeof cacheKey): Promise<{ 'tobirink.popup-continuations.v1'?: unknown }>;
  set(items: { 'tobirink.popup-continuations.v1': PopupContinuationCacheEnvelope }): Promise<void>;
}

export class WebExtensionPageContextAdapter implements PageContextPort {
  constructor(private readonly tabs: TabsApi) {}

  async readActivePage(): Promise<{ title: string; url: string } | undefined> {
    const [tab] = await this.tabs.query({ active: true, currentWindow: true });
    if (!tab?.title?.trim() || !tab.url) return undefined;
    try {
      const url = new URL(tab.url);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
      return { title: tab.title.trim(), url: tab.url };
    } catch {
      return undefined;
    }
  }
}

export class WebExtensionPopupContinuationCacheAdapter implements PopupContinuationCachePort {
  constructor(private readonly storage: StorageAreaApi) {}

  async read(): Promise<readonly PopupContinuationRecord[]> {
    const result = await this.storage.get(cacheKey);
    const envelope = popupContinuationCacheEnvelopeSchema.safeParse(result[cacheKey]);
    return envelope.success ? envelope.data.items : [];
  }

  async write(items: readonly PopupContinuationRecord[]): Promise<void> {
    await this.storage.set({ [cacheKey]: { items: [...items], schemaVersion: cacheSchemaVersion } });
  }
}
