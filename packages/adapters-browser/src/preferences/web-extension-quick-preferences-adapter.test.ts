import { describe, expect, it } from 'vitest';
import { defaultQuickPreferences } from '@tobirink/application';
import { WebExtensionQuickPreferencesAdapter } from './web-extension-quick-preferences-adapter';
interface PreferenceFixture { value?: object }

describe('WebExtensionQuickPreferencesAdapter', () => {
  it('uses privacy-safe defaults and persists only the strict preference contract', async () => {
    const fixture: PreferenceFixture = {};
    const adapter = new WebExtensionQuickPreferencesAdapter({
      async get() { return { 'tobirink.quick-preferences.v1': fixture.value }; },
      async set(value) { fixture.value = value['tobirink.quick-preferences.v1']; },
    });
    await expect(adapter.read()).resolves.toEqual(defaultQuickPreferences);
    const preferences = { nativeNotifications: true, showEstimatedReleases: false };
    await adapter.write(preferences);
    await expect(adapter.read()).resolves.toEqual(preferences);
    fixture.value = { nativeNotifications: true, unknown: true };
    await expect(adapter.read()).resolves.toEqual(defaultQuickPreferences);
  });
});
