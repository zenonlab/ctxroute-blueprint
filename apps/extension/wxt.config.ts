import { defineConfig } from 'wxt';
import extensionPackage from './package.json' with { type: 'json' };

const siteOrigin = process.env.WXT_PUBLIC_SITE_ORIGIN?.trim();
const externallyConnectableMatches = siteOrigin ? [`${siteOrigin}/*`] : [];

const extensionIcons = {
  16: 'icons/tobirink-16.png',
  32: 'icons/tobirink-32.png',
  48: 'icons/tobirink-48.png',
  128: 'icons/tobirink-128.png',
} as const;

export default defineConfig({
  entrypointsDir: 'wxt-entrypoints',
  manifest: ({ browser }) => ({
    browser_specific_settings: browser === 'firefox'
      ? {
          gecko: {
            data_collection_permissions: { required: ['none'] },
            id: 'tobirink@tobirink.local',
          },
        }
      : undefined,
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';",
    },
    description: 'Bibliothèque manga et anime privée, progression, Review et agenda.',
    externally_connectable: { matches: externallyConnectableMatches },
    host_permissions: [],
    icons: extensionIcons,
    name: 'Tobirink',
    permissions: ['storage', 'bookmarks', 'alarms', 'notifications', 'activeTab'],
    action: { default_icon: extensionIcons },
    version: extensionPackage.version,
  }),
  manifestVersion: 3,
  modules: ['@wxt-dev/module-react'],
});
