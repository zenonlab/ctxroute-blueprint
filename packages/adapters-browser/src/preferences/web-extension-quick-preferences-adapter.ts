import { defaultQuickPreferences, quickPreferencesSchema } from '@tobirink/application';
import type { QuickPreferences, QuickPreferencesPort } from '@tobirink/application';

const preferenceKey = 'tobirink.quick-preferences.v1';

export interface WebExtensionPreferencesStorage {
  get(key: typeof preferenceKey): Promise<{ 'tobirink.quick-preferences.v1'?: unknown }>;
  set(value: { 'tobirink.quick-preferences.v1': QuickPreferences }): Promise<void>;
}

export class WebExtensionQuickPreferencesAdapter implements QuickPreferencesPort {
  constructor(private readonly storage: WebExtensionPreferencesStorage) {}
  async read(): Promise<QuickPreferences> {
    const parsed = quickPreferencesSchema.safeParse((await this.storage.get(preferenceKey))[preferenceKey]);
    return parsed.success ? parsed.data : defaultQuickPreferences;
  }
  async write(preferences: QuickPreferences): Promise<void> {
    await this.storage.set({ [preferenceKey]: quickPreferencesSchema.parse(preferences) });
  }
}
