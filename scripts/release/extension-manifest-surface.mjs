const commonManifestKeys = [
  'action', 'background', 'content_scripts', 'content_security_policy', 'description',
  'externally_connectable', 'host_permissions', 'icons', 'manifest_version', 'name',
  'options_ui', 'permissions', 'version',
];

export function extensionManifestKeys(target) {
  if (target === 'chrome-mv3') return [...commonManifestKeys, 'minimum_chrome_version'].sort();
  if (target === 'firefox-mv3') return [...commonManifestKeys, 'browser_specific_settings'].sort();
  throw new Error(`Unsupported extension target ${target}.`);
}

export function assertExtensionManifestRootSurface(manifest, target) {
  const expected = extensionManifestKeys(target);
  const actual = Object.keys(manifest).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Manifest root surface mismatch for ${target}.`);
}
