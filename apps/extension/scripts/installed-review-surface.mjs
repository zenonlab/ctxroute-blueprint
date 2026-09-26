import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { assertExtensionManifestRootSurface } from '../../../scripts/release/extension-manifest-surface.mjs';

const publicOrigin = 'https://tobirink.com';
const publicMatch = publicOrigin + '/*';
const extensionPagesPolicy = "script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; connect-src https://tobirink.com;";
const permissions = ['storage', 'bookmarks', 'alarms', 'notifications', 'activeTab'];
const manifestSchema = z.object({
  background: z.strictObject({ service_worker: z.string().min(1), type: z.literal('module') }),
  content_security_policy: z.strictObject({ extension_pages: z.string().min(1) }),
  content_scripts: z.array(z.strictObject({ js: z.array(z.string()), matches: z.array(z.string()), run_at: z.string() })),
  declarative_net_request: z.never().optional(),
  externally_connectable: z.strictObject({ matches: z.array(z.string()) }),
  host_permissions: z.array(z.string()),
  manifest_version: z.literal(3),
  minimum_chrome_version: z.literal('140'),
  optional_host_permissions: z.array(z.string()).optional(),
  optional_permissions: z.array(z.string()).optional(),
  permissions: z.array(z.string()),
});

export async function assertInstalledReviewExtensionSurface(extensionRoot) {
  const rawManifest = JSON.parse(await readFile(join(extensionRoot, 'manifest.json'), 'utf8'));
  assertExtensionManifestRootSurface(rawManifest, 'chrome-mv3');
  const manifest = manifestSchema.parse(rawManifest);
  assert.equal(manifest.background.service_worker, 'background.js', 'Installed-review requires the packaged service worker.');
  assert.equal(manifest.content_security_policy.extension_pages, extensionPagesPolicy, 'Installed-review requires the HTTPS-only connection policy.');
  assert.deepEqual(manifest.content_scripts, [{ js: ['content-scripts/web-bridge.js'], matches: [publicMatch], run_at: 'document_start' }], 'Installed-review requires one bounded content script.');
  assert.deepEqual(manifest.externally_connectable.matches, [publicMatch], 'Installed-review requires one external origin.');
  assert.deepEqual(manifest.host_permissions, [publicMatch], 'Installed-review requires one host origin.');
  assert.deepEqual(manifest.optional_host_permissions ?? [], [], 'Installed-review forbids optional host permissions.');
  assert.deepEqual(manifest.optional_permissions ?? [], [], 'Installed-review forbids optional extension permissions.');
  assert.deepEqual(manifest.permissions, permissions, 'Installed-review requires the exact extension permissions.');
}
