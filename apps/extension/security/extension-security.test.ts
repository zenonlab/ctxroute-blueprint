import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { extensionMessageSchema } from '../runtime/messages';

const generatedManifestSchema = z.object({
  action: z.object({
    default_icon: z.record(z.string(), z.string()),
    default_popup: z.string(),
  }),
  browser_specific_settings: z.object({
    gecko: z.object({
      data_collection_permissions: z.object({ required: z.tuple([z.literal('bookmarksInfo')]) }),
      id: z.literal('tobirink@tobirink.local'),
    }),
  }).optional(),
  content_security_policy: z.object({ extension_pages: z.string() }),
  host_permissions: z.array(z.string()).optional(),
  externally_connectable: z.object({ matches: z.array(z.string()).min(1) }).optional(),
  content_scripts: z.array(z.object({ matches: z.array(z.string()).min(1) })).optional(),
  minimum_chrome_version: z.string().optional(),
  icons: z.record(z.string(), z.string()),
  manifest_version: z.number(),
  permissions: z.array(z.string()),
});

async function chromeManifest() {
  return generatedManifestSchema.parse(JSON.parse(await readFile('.output/chrome-mv3/manifest.json', 'utf8')));
}

async function firefoxManifest() {
  return generatedManifestSchema.parse(JSON.parse(await readFile('.output/firefox-mv3/manifest.json', 'utf8')));
}

describe('extension security boundary', () => {
  it.each([
    ['chrome-mv3', chromeManifest],
    ['firefox-mv3', firefoxManifest],
  ])('generates a bounded %s manifest', async (_target, loadManifest) => {
    const value = await loadManifest();
    const allowed = new Set(['activeTab', 'alarms', 'bookmarks', 'notifications', 'sidePanel', 'storage']);
    expect(value.manifest_version).toBe(3);
    if (_target === 'chrome-mv3') expect(value.minimum_chrome_version).toBe('140');
    expect(value.host_permissions ?? []).toEqual([
      'https://api.mangadex.org/*',
      'https://api.mangaupdates.com/*',
      'https://graphql.anilist.co/*',
      'https://kitsu.io/*',
      ...(value.externally_connectable?.matches ?? []),
    ]);
    expect(value.permissions?.every((permission) => allowed.has(permission))).toBe(true);
    expect(value.permissions).toEqual(expect.arrayContaining(['activeTab', 'alarms', 'bookmarks', 'notifications', 'storage']));
    expect(value.icons).toEqual({
      16: 'icons/tobirink-16.png',
      32: 'icons/tobirink-32.png',
      48: 'icons/tobirink-48.png',
      128: 'icons/tobirink-128.png',
    });
    expect(value.action.default_icon).toEqual(value.icons);
    expect(value.action.default_popup).toBe('popup.html');
    const policy = value.content_security_policy.extension_pages;
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toMatch(/https?:|unsafe-eval/);
  });

  it('accepts only the closed versioned message contract', () => {
    expect(extensionMessageSchema.safeParse({ type: 'health.check', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ target: 'library', type: 'navigation.open', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ type: 'popup.context.read', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ type: 'review.queue.read', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ type: 'organizer.configuration.read', version: 1 }).success).toBe(true);
    expect(extensionMessageSchema.safeParse({ target: 'tabs', type: 'navigation.open', version: 1 }).success).toBe(false);
    expect(extensionMessageSchema.safeParse({ target: 'library', token: 'extra', type: 'navigation.open', version: 1 }).success).toBe(false);
    expect(extensionMessageSchema.safeParse({ type: 'health.check', version: 2 }).success).toBe(false);
    expect(extensionMessageSchema.safeParse({ extra: true, type: 'popup.context.read', version: 1 }).success).toBe(false);
    expect(extensionMessageSchema.safeParse(null).success).toBe(false);
  });

  it('declares the bounded Firefox bookmark transmission and a stable signing ID', async () => {
    const value = await firefoxManifest();
    expect(value.browser_specific_settings?.gecko.data_collection_permissions.required).toEqual(['bookmarksInfo']);
    expect(value.browser_specific_settings?.gecko.id).toBe('tobirink@tobirink.local');
  });

  it('keeps IndexedDB behind the background composition root', async () => {
    const packageManifest = z.object({
      dependencies: z.record(z.string(), z.string()),
    }).parse(JSON.parse(await readFile('package.json', 'utf8')));
    const background = await readFile('wxt-entrypoints/background.ts', 'utf8');
    const localStorage = await readFile('runtime/local-storage.ts', 'utf8');
    const favoriteResolution = await readFile('runtime/favorite-resolution-runtime.ts', 'utf8');

    expect(packageManifest.dependencies['@tobirink/adapters-indexeddb']).toBe('*');
    expect(background).toMatch(/createExtensionLocalStorage\(\)/);
    expect(background).toMatch(/await privateStorage\.ensureReady\(\)/);
    expect(background).toMatch(/browser\.runtime\.onInstalled\.addListener/);
    expect(favoriteResolution).toMatch(/readBookmarkBatch\(cursor, 100\)/);
    expect(favoriteResolution).toMatch(/normalizeBookmarks\(slice\.records\)/);
    expect(favoriteResolution).toMatch(/importFavoriteSources\(favorites, dependencies\.storage/);
    expect(background).toMatch(/WebExtensionBookmarkEventAdapter\(browser\.bookmarks\)/);
    expect(background).toMatch(/DexieFavoriteResolutionOutbox\(privateStorage\.storage\.database\)/);
    expect(background).toMatch(/createFavoriteResolutionRuntime/);
    expect(background).toMatch(/readReviewQueue\(privateStorage\.storage\)/);
    expect(background).toMatch(/readLocalReviewCandidateSnapshot\(privateStorage\.storage/);
    expect(background).toMatch(/writeLocalReviewDecision\(privateStorage\.storage/);
    expect(background).toMatch(/readLocalSearchSnapshot\(privateStorage\.storage/);
    expect(background).not.toMatch(/HttpReviewCandidateAdapter|fetch\(/);
    expect(background).toMatch(/WebExtensionPublicReleaseCacheAdapter\(browser\.storage\.local\)/);
    expect(background).toMatch(/WebExtensionQuickPreferencesAdapter\(browser\.storage\.local\)/);
    expect(background).not.toMatch(/PublicReleaseSnapshotAdapter|loadLatest\(/);
    expect(background).toMatch(/readPopupContext\(\{[\s\S]*storage: privateStorage\.storage[\s\S]*\}\)/);
    expect(background).toMatch(/saveOrganizerConfiguration\(privateStorage\.storage/);
    expect(background).toMatch(/readOrganizerPreview\(privateStorage\.storage/);
    expect(background).toMatch(/applyConfirmedOrganizerPreview/);
    expect(background).toMatch(/DexieOrganizerSnapshotStore/);
    expect(background).not.toMatch(/bookmarks\.(?:create|move|remove|update)\s*\(/);
    expect(favoriteResolution).not.toMatch(/browser\.|chrome\.|fetch\s*\(/);
    expect(localStorage).toMatch(/new DexieStoragePort\(extensionDatabaseName\)/);
    expect(localStorage).not.toMatch(/browser\.|chrome\.|fetch\s*\(/);
  });
});
