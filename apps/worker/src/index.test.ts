import { env, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { isPublicSiteRoute } from './index';

describe('public site fallback', () => {
  it('allows only declared static routes and one public work identifier', () => {
    expect(['/', '/library', '/agenda', '/privacy', '/download', '/library/work_1'].every(isPublicSiteRoute)).toBe(true);
    expect(['/v1/releases', '/downloads/archive.zip', '/library/a/b', '/unknown'].some(isPublicSiteRoute)).toBe(false);
  });

  it('preserves immutable headers on public release downloads', async () => {
    const artifact = 'tobirink-chrome-mv3-1.0.0.zip';
    await env.RELEASE_SNAPSHOTS.put('downloads/tobirink-chrome-mv3-1.0.0.zip', new Uint8Array([1, 2, 3]), {
      httpMetadata: { contentType: 'application/zip' },
    });
    const response = await SELF.fetch('https://tobirink.test/downloads/tobirink-chrome-mv3-1.0.0.zip');
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(response.headers.get('content-disposition')).toContain(artifact);
    expect(response.headers.get('x-tobirink-request-id')).toMatch(/^[0-9a-f-]{36}$/u);
  });
});
