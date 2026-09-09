import { describe, expect, it } from 'vitest';
import { CloudflareCoverImageAdapter, R2CoverMasterReadAdapter } from '@tobirink/adapters-cloudflare';

import { COVER_VARIANTS, createCoverMediaApp } from './cover-routes';
import { cloudPolicy } from '../cloud-policy';

const digest = 'a'.repeat(64);

function mediaBindings(found = true) {
  const reads: string[] = [];
  const transforms: ImageTransform[] = [];
  const outputs: ImageOutputOptions[] = [];
  const bucket = {
    async get(key: string) {
      reads.push(key);
      if (!found) return null;
      return { body: new Blob([new Uint8Array([1, 2, 3])]).stream() };
    },
  };
  const images = {
    input(_body: ReadableStream) {
      return {
        transform(transform: ImageTransform) {
          transforms.push(transform);
          return this;
        },
        async output(output: ImageOutputOptions) {
          outputs.push(output);
          return {
            response({ headers }: { headers: HeadersInit }) {
              return new Response(new Uint8Array([4, 5, 6]), { headers, status: 200 });
            },
          };
        },
      };
    },
  };
  const services = {
    coverImages: new CloudflareCoverImageAdapter(images),
    coverMasters: new R2CoverMasterReadAdapter(bucket),
    policy: cloudPolicy,
  };
  return { outputs, reads, services, transforms };
}

describe('cover media routes', () => {
  it('exposes exactly the three fixed scale-down variants', async () => {
    expect(Object.keys(COVER_VARIANTS)).toEqual(['cover-lg', 'cover-md', 'cover-sm']);
    for (const [variant, dimensions] of Object.entries(COVER_VARIANTS)) {
      const fixture = mediaBindings();
      const response = await createCoverMediaApp(fixture.services).request(
        `https://api.example/v1/media/covers/${digest}/jpg/${variant}`,
        { headers: { Accept: 'image/avif,image/webp' } },
      );
      expect(response.status).toBe(200);
      expect(fixture.transforms).toEqual([{ ...dimensions, fit: 'scale-down' }]);
      expect(fixture.outputs).toEqual([{ format: 'image/avif', quality: 82 }]);
    }
  });

  it.each([
    [`https://api.example/v1/media/covers/${digest}/jpg/cover-xl`, 404],
    [`https://api.example/v1/media/covers/${digest}/jpg/cover-sm?width=400`, 400],
    ['https://api.example/v1/media/covers/not-a-hash/jpg/cover-sm', 404],
  ])('rejects arbitrary transformation input: %s', async (url, status) => {
    const fixture = mediaBindings();
    const response = await createCoverMediaApp(fixture.services).request(url);
    expect(response.status).toBe(status);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(fixture.reads).toHaveLength(0);
  });

  it('returns a bounded immutable response and supports conditional reads', async () => {
    const fixture = mediaBindings();
    const url = `https://api.example/v1/media/covers/${digest}/png/cover-md`;
    const response = await createCoverMediaApp(fixture.services).request(url);

    expect(fixture.reads).toEqual([`covers/masters/sha256/${digest}.png`]);
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('Vary')).toBe('Accept');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');

    const cached = await createCoverMediaApp(fixture.services).request(url, {
      headers: { 'If-None-Match': response.headers.get('ETag') ?? '' },
    });
    expect(cached.status).toBe(304);
    expect(fixture.reads).toHaveLength(1);
  });

  it('does not transform a missing master', async () => {
    const fixture = mediaBindings(false);
    const response = await createCoverMediaApp(fixture.services).request(
      `https://api.example/v1/media/covers/${digest}/webp/cover-sm`,
    );
    expect(response.status).toBe(404);
    expect(fixture.transforms).toHaveLength(0);
  });

  it.each(['POST', 'PUT', 'DELETE'])('does not expose R2 ingestion through %s', async (method) => {
    const fixture = mediaBindings();
    const response = await createCoverMediaApp(fixture.services).request(
      `https://api.example/v1/media/covers/${digest}/jpg/cover-sm`,
      { method },
    );

    expect(response.status).toBe(404);
    expect(fixture.reads).toHaveLength(0);
    expect(fixture.transforms).toHaveLength(0);
  });
});
