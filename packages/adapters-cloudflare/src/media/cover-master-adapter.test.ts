import { describe, expect, it } from 'vitest';

import type { CoverObjectStore, NormalizedCoverMaster } from './cover-master-adapter';
import { R2CoverMasterAdapter } from './cover-master-adapter';

function validMaster(overrides: Partial<NormalizedCoverMaster> = {}): NormalizedCoverMaster {
  return {
    bytes: new Uint8Array([1, 2, 3, 4]),
    colorSpace: 'srgb',
    contentType: 'image/png',
    height: 900,
    metadataStripped: true,
    orientationNormalized: true,
    rightsStatus: 'licensed',
    sourceUrl: 'https://provider.example/cover.png',
    width: 600,
    ...overrides,
  };
}

function objectStore() {
  const puts: Array<{ key: string; options: Parameters<CoverObjectStore['put']>[2] }> = [];
  const keys = new Set<string>();
  const store: CoverObjectStore = {
    async head(key) {
      return keys.has(key) ? { etag: 'existing', key } : null;
    },
    async put(key, _value, options) {
      puts.push({ key, options });
      if (keys.has(key)) return null;
      keys.add(key);
      return { etag: 'new', key };
    },
  };
  return { keys, puts, store };
}

describe('R2CoverMasterAdapter', () => {
  it('checks copying rights before touching object storage', async () => {
    const { puts, store } = objectStore();
    const adapter = new R2CoverMasterAdapter(store);
    const unlicensed = validMaster();
    Reflect.set(unlicensed, 'rightsStatus', 'unknown');

    await expect(adapter.ingest(unlicensed)).rejects.toThrow('not permitted');
    expect(puts).toHaveLength(0);
  });

  it('stores one immutable content-addressed normalized master', async () => {
    const { puts, store } = objectStore();
    const result = await new R2CoverMasterAdapter(store).ingest(validMaster({ attribution: 'Example' }));

    expect(result.key).toMatch(/^covers\/masters\/sha256\/[a-f0-9]{64}\.png$/);
    expect(result.created).toBe(true);
    expect(puts).toHaveLength(1);
    expect(puts[0]?.options).toMatchObject({
      customMetadata: {
        attribution: 'Example',
        colorSpace: 'srgb',
        metadataStripped: 'true',
        orientationNormalized: 'true',
        rightsStatus: 'licensed',
      },
      httpMetadata: { cacheControl: 'public, max-age=31536000, immutable', contentType: 'image/png' },
      onlyIf: { etagDoesNotMatch: '*' },
    });
  });

  it('does not rewrite an existing content hash', async () => {
    const fixture = validMaster();
    const { puts, store } = objectStore();
    const adapter = new R2CoverMasterAdapter(store);
    const first = await adapter.ingest(fixture);
    const second = await adapter.ingest(fixture);

    expect(first.key).toBe(second.key);
    expect(second.created).toBe(false);
    expect(puts).toHaveLength(1);
  });

  it.each([
    { bytes: new Uint8Array(), label: 'empty input' },
    { height: 8193, label: 'oversized dimensions' },
    { sourceUrl: 'http://provider.example/cover.png', label: 'non-HTTPS provenance' },
  ])('rejects $label', async ({ label: _label, ...override }) => {
    const { store } = objectStore();
    await expect(new R2CoverMasterAdapter(store).ingest(validMaster(override))).rejects.toThrow();
  });

  it('rejects a master that has not completed normalization', async () => {
    const master = validMaster();
    Reflect.set(master, 'metadataStripped', false);
    const { store } = objectStore();

    await expect(new R2CoverMasterAdapter(store).ingest(master)).rejects.toThrow('not normalized');
  });
});
