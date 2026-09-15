import { applyD1Migrations, env } from 'cloudflare:test';
import { D1PublicDiscoveryV3Adapter } from '@tobirink/adapters-cloudflare';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createPublicDiscoveryApp } from './public-discovery-routes';

function key(marker: string) {
  return { fingerprint: marker.repeat(64), mediaKind: 'ANIME' as const, parserVersion: '5', siteRulesVersion: '3' };
}

function submission(marker: string, title: string) {
  return { key: key(marker), query: { discoveryTitles: [title], mediaKind: 'ANIME' as const, sourceTitles: [title] }, schemaVersion: 3 as const };
}

beforeEach(async () => applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS));

describe('public discovery queue trigger', () => {
  it('enqueues only an opaque signal after a cache miss', async () => {
    const queue = { send: vi.fn(async () => undefined) };
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB), queue });
    const response = await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify(submission('4', 'Private raw title')),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(response.status).toBe(202);
    expect(queue.send).toHaveBeenCalledExactlyOnceWith({ type: 'public-discovery-ready', version: 1 }, { contentType: 'json' });
    expect(JSON.stringify(queue.send.mock.calls)).not.toContain('Private');
  });

  it('returns 503 but preserves PENDING when the queue is unavailable', async () => {
    const adapter = new D1PublicDiscoveryV3Adapter(env.PUBLIC_DB);
    const app = createPublicDiscoveryApp({ publicDiscoveryV3: adapter, queue: { send: async () => { throw new Error('queue-down'); } } });
    const discoveryKey = key('5');
    const response = await app.request('https://tobirink.test/v3/catalogue/discoveries/requests', {
      body: JSON.stringify(submission('5', 'Queue retry')),
      headers: { 'Content-Type': 'application/json' }, method: 'POST',
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'discovery-queue-unavailable' });
    await expect(adapter.read(discoveryKey, new Date().toISOString())).resolves.toMatchObject({ state: 'PENDING' });
  });
});
