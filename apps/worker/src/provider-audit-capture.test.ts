import { describe, expect, it, vi } from 'vitest';
import { captureProviderFetch, type ProviderAuditExchange } from './provider-audit-capture';
import { ProviderTransportResponseError } from './provider-transport-adapter';

describe('provider audit capture', () => {
  it('captures allowlisted request and response data without consuming the response', async () => {
    const exchanges: ProviderAuditExchange[] = [];
    const fetcher = vi.fn(async () => new Response('{"errors":[{"message":"temporary outage"}]}', {
      headers: { 'content-type': 'application/json', 'retry-after': '60', 'x-request-id': 'request-123', 'set-cookie': 'private=secret' }, status: 503,
    }));
    const wrapped = captureProviderFetch(fetcher, exchanges);
    const response = await wrapped('https://graphql.anilist.co/', {
      body: JSON.stringify({ query: 'query ($search: String!) { Media(search: $search) { id } }', variables: { search: 'Private title' } }),
      headers: { Authorization: 'Bearer must-not-be-captured', 'Content-Type': 'application/json' }, method: 'POST',
    });

    expect(await response.text()).toContain('temporary outage');
    expect(exchanges).toEqual([{
      contentType: 'application/json', method: 'POST', requestHeaders: [
        { name: 'content-type', value: 'application/json' }, { name: 'user-agent', value: 'TobiRink/1.0 (+https://tobirink.com)' },
      ],
      requestBody: expect.stringContaining('Private title'),
      responseBody: expect.stringContaining('temporary outage'), responseStatus: 503,
      responseHeaders: [{ name: 'retry-after', value: '60' }, { name: 'x-request-id', value: 'request-123' }],
      target: 'https://graphql.anilist.co/', truncated: false,
    }]);
    expect(JSON.stringify(exchanges)).not.toContain('must-not-be-captured');
    expect(JSON.stringify(exchanges)).not.toContain('set-cookie');
  });

  it('bounds captured bodies, leaves non-allowlisted targets untouched, and records transport failure', async () => {
    const exchanges: ProviderAuditExchange[] = [];
    const fetcher = vi.fn(async () => { throw new Error('must not be serialized'); });
    const wrapped = captureProviderFetch(fetcher, exchanges);
    await expect(wrapped('https://graphql.anilist.co/', { body: 'x'.repeat(10_000), method: 'POST' })).rejects.toThrow('must not be serialized');
    expect(exchanges[0]?.truncated).toBe(true);
    expect(exchanges[0]?.requestBody).toHaveLength(8 * 1024);
    await expect(wrapped('https://example.com/private?token=secret', { method: 'GET' })).rejects.toThrow('must not be serialized');
    expect(exchanges).toHaveLength(1);
    expect(JSON.stringify(exchanges)).not.toContain('secret');
  });

  it('stops waiting on a stalled provider body without consuming the caller response', async () => {
    const exchanges: ProviderAuditExchange[] = [];
    const fetcher = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('partial')); },
    }), { status: 503 }));
    const wrapped = captureProviderFetch(fetcher, exchanges);
    const response = await wrapped('https://graphql.anilist.co/', { method: 'POST', body: '{}' });
    expect(exchanges[0]).toMatchObject({ responseBody: 'partial', responseStatus: 503, truncated: true });
    const reader = response.body!.getReader();
    expect(await reader.read()).toMatchObject({ done: false, value: new TextEncoder().encode('partial') });
    await reader.cancel();
  });

  it('retains rejected redirect responses and classifies transport failures without error text', async () => {
    const exchanges: ProviderAuditExchange[] = [];
    const redirect = captureProviderFetch(async () => {
      throw new ProviderTransportResponseError(new Response('redirect rejected', {
        headers: { location: 'https://untrusted.example/path', 'x-request-id': 'redirect-456' }, status: 302,
      }));
    }, exchanges);
    await expect(redirect('https://graphql.anilist.co/', { method: 'POST', body: '{}' })).rejects.toThrow('provider-transport-redirect');
    expect(exchanges[0]).toMatchObject({ responseStatus: 302, responseBody: 'redirect rejected', responseHeaders: [{ name: 'x-request-id', value: 'redirect-456' }] });
    expect(JSON.stringify(exchanges)).not.toContain('untrusted.example');

    const network = captureProviderFetch(async () => { throw new TypeError('network detail with private payload'); }, exchanges);
    await expect(network('https://graphql.anilist.co/', { method: 'POST', body: '{}' })).rejects.toThrow('private payload');
    expect(exchanges[1]).toMatchObject({ transportFailure: 'network-error' });
    expect(JSON.stringify(exchanges)).not.toContain('private payload');
  });
});
