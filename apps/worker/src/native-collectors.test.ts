import { afterEach, describe, expect, it, vi } from 'vitest';
import { FavoriteProviderRetryError, PublicDiscoverySearchContinuationError, type FavoriteProviderPort, type PublicDiscoveryProviderPorts } from '@tobirink/public-discovery';
import { z } from 'zod';
import { discoveryFailureCause } from './native-collectors';
import { AgendaCollectionRetryError, agendaCollectionFailureCode, collectorCost, createBudgetedDiscoveryResolver, handleNativeCollectorQueue, providerFailureCode, resolveWithDeadline, type NativeCollectorSignal } from './native-collectors';
import { instrumentProviderFetch } from './operational-metrics';

function message(body: NativeCollectorSignal | null, attempts = 1) {
  return { ack: vi.fn(), attempts, body, retry: vi.fn() };
}

describe('native collector queue', () => {
  it('classifies durable failures without preserving arbitrary exception text', () => {
    expect(discoveryFailureCause(new FavoriteProviderRetryError('probe deferred', 600_000, new Error('Favorite provider request failed with HTTP 429.')))).toEqual({ code: 'http', httpStatus: 429, stage: 'resolve' });
    expect(discoveryFailureCause(new FavoriteProviderRetryError('probe deferred', 600_000, new Error('private title https://private.example/secret')))).toEqual({ code: 'unknown', stage: 'resolve' });
    expect(discoveryFailureCause(new Error('Favorite provider request failed with HTTP 403.'))).toEqual({ code: 'http', httpStatus: 403, stage: 'resolve' });
    expect(discoveryFailureCause(new Error('incomplete-provider-search:cursor'))).toEqual({ code: 'search-cursor', stage: 'resolve' });
    expect(discoveryFailureCause(new Error('incomplete-provider-search:projection'))).toEqual({ code: 'search-projection', stage: 'resolve' });
    expect(discoveryFailureCause(new Error('D1_ERROR: private title'))).toEqual({ code: 'runtime-d1', stage: 'resolve' });
    expect(discoveryFailureCause(new Error('provider-gateway-private https://private.example/secret'))).toEqual({ code: 'gateway', stage: 'resolve' });
    expect(discoveryFailureCause(new Error('private title https://private.example/secret'))).toEqual({ code: 'unknown', stage: 'resolve' });
    expect(discoveryFailureCause(undefined)).toEqual({ code: 'unknown', stage: 'resolve' });
    expect(discoveryFailureCause(new z.ZodError([{ code: 'invalid_type', expected: 'string', path: ['data', 0, 'titles', 'private-title'], message: 'private-payload' }]))).toEqual({ code: 'invalid-response', stage: 'resolve', field: 'titles', validation: 'invalid_type' });
  });
  afterEach(() => vi.restoreAllMocks());

  it('emits bounded provider failure codes without error payloads', () => {
    const privateTitle = 'private title';
    const privateUrl = 'https://private.example/favorites/secret';
    expect(providerFailureCode(new FavoriteProviderRetryError('Provider cadence requires a later wake.', Date.now() + 1_000))).toBe('provider-cadence-deferred');
    expect(providerFailureCode(new Error('incomplete-provider-search:deadline'))).toBe('provider-search-deadline');
    expect(providerFailureCode(new Error('incomplete-provider-search:page-limit'))).toBe('provider-search-page-limit');
    expect(providerFailureCode(new Error('incomplete-provider-search:projection'))).toBe('provider-search-projection');
    expect(providerFailureCode(new Error('Favorite provider request failed with HTTP 429.'))).toBe('provider-http-429');
    expect(providerFailureCode(new Error('Public discovery resolution exceeded its bounded execution window.'))).toBe('provider-resolution-deadline');
    expect(providerFailureCode(new Error('fetch failed'))).toBe('provider-network');
    expect(providerFailureCode(new Error(`${privateTitle} from unexpected error`))).toBe('provider-unavailable');
    const invalid = new z.ZodError([{ code: 'invalid_type', expected: 'string', path: ['data', 0, 'attributes', 'titles', 'private-language'], message: privateTitle }]);
    expect(providerFailureCode(invalid)).toBe('provider-response-invalid-titles-invalid_type');
    expect(providerFailureCode(new z.ZodError([{ code: 'invalid_type', expected: 'string', path: ['private-title'], message: privateTitle }]))).toBe('provider-response-invalid-unknown-invalid_type');
    expect(providerFailureCode(new z.ZodError([{ code: 'too_big', origin: 'array', maximum: 16, inclusive: true, path: ['data', 0, 'attributes', 'abbreviatedTitles'], message: privateTitle }]))).toBe('provider-response-invalid-abbreviatedTitles-too_big');
    expect(providerFailureCode(new z.ZodError([{ code: 'too_big', origin: 'array', maximum: 25, inclusive: true, path: ['private-field'], message: privateTitle }]))).toBe('provider-response-invalid-unknown-too_big-max25');
    expect(providerFailureCode(new z.ZodError([{ code: 'too_big', origin: 'array', maximum: 2048, inclusive: true, path: ['private-field'], message: privateTitle }]))).toBe('provider-response-invalid-unknown-too_big');
    const classified = [
      providerFailureCode(new SyntaxError(`Unexpected token in ${privateTitle} from ${privateUrl}`)),
      providerFailureCode(new Error('Kitsu hydration returned a different media identity.')),
      providerFailureCode(new TypeError('cover origin is not allowed for kitsu-anime')),
      providerFailureCode(new URIError(`URI malformed for ${privateTitle} at ${privateUrl}`)),
      providerFailureCode(new TypeError(`Invalid URL: ${privateUrl}`)),
      providerFailureCode(new TypeError(`The encoded data was not valid for encoding utf-8: ${privateTitle}`)),
      providerFailureCode(new Error('provider-runtime-state-missing')),
      providerFailureCode(new TypeError('invalid-provider-runtime-reservation')),
      providerFailureCode(new Error(`D1_ERROR: ${privateTitle} ${privateUrl}`)),
    ];
    expect(classified).toEqual([
      'provider-response-invalid-json',
      'provider-response-invalid-kitsu-identity',
      'provider-response-invalid-cover-origin',
      'provider-response-invalid-uri',
      'provider-response-invalid-uri',
      'provider-response-invalid-encoding',
      'provider-runtime-state-missing',
      'provider-runtime-reservation-invalid',
      'provider-runtime-d1',
    ]);
    expect(JSON.stringify(classified)).not.toContain(privateTitle);
    expect(JSON.stringify(classified)).not.toContain(privateUrl);
  });

  it('logs only a bounded provider operation code for an invalid response', async () => {
    const privateTitle = 'private title';
    const privateUrl = 'https://private.example/favorites/secret';
    const invalid = new SyntaxError(`Unexpected token in ${privateTitle} from ${privateUrl}`);
    const port = (provider: keyof PublicDiscoveryProviderPorts): FavoriteProviderPort => ({
      hydrate: async () => undefined,
      search: async () => ({ candidates: [], complete: true, digest: 'fixture', provider, truncated: false }),
    });
    const search = vi.fn(async () => { throw invalid; });
    const providers: PublicDiscoveryProviderPorts = {
      anilist: port('anilist'), mangaupdates: port('mangaupdates'), mangadex: port('mangadex'), 'kitsu-anime': port('kitsu-anime'),
      'kitsu-manga': { ...port('kitsu-manga'), search },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const correlationId = '00000000-0000-4000-8000-000000000001';
    const resolver = createBudgetedDiscoveryResolver(providers, () => 0, () => 1, 100_000, correlationId);
    await expect(resolver.resolve({
      attempt: 1, key: { fingerprint: 'a'.repeat(64), mediaKind: 'MANGA', parserVersion: 'parser-v1', siteRulesVersion: 'rules-v1' },
      query: { discoveryTitles: ['private title'], mediaKind: 'MANGA', sourceTitles: ['private title'] },
      requestDigest: 'b'.repeat(64), schemaVersion: 3,
    })).rejects.toThrow('private title');
    expect(search).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(JSON.stringify({ schemaVersion: 1, type: 'native-collector.provider-operation-failed', correlationId,
      provider: 'kitsu-manga', operation: 'search', code: 'provider-response-invalid-json' }));
    expect(JSON.stringify(warn.mock.calls)).not.toContain(privateTitle);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(privateUrl);
  });

  it('continues known-media searches after the invocation budget without repeating completed aliases', async () => {
    const titles = ['Alpha', 'Beta', 'Gamma', 'Delta'];
    const searched: string[] = [];
    let callsInInvocation = 0;
    const providerPort = (provider: keyof PublicDiscoveryProviderPorts): FavoriteProviderPort => ({
      hydrate: async () => undefined,
      search: async ({ titles: queryTitles }) => {
        callsInInvocation += 1;
        searched.push(`${provider}:${queryTitles[0]}`);
        return { candidates: [], complete: true, digest: 'empty', provider, truncated: false };
      },
    });
    const providers: PublicDiscoveryProviderPorts = {
      anilist: providerPort('anilist'), mangaupdates: providerPort('mangaupdates'), mangadex: providerPort('mangadex'),
      'kitsu-anime': providerPort('kitsu-anime'), 'kitsu-manga': providerPort('kitsu-manga'),
    };
    const input = { attempt: 1, key: { fingerprint: 'a'.repeat(64), mediaKind: 'MANGA' as const, parserVersion: 'parser-v1', siteRulesVersion: 'rules-v1' },
      query: { discoveryTitles: titles, mediaKind: 'MANGA' as const, sourceTitles: titles }, requestDigest: 'b'.repeat(64), schemaVersion: 3 as const };
    let checkpoint;
    let result;
    for (let passage = 0; passage < 6; passage += 1) {
      callsInInvocation = 0;
      const resolver = createBudgetedDiscoveryResolver(providers, () => callsInInvocation * 4, () => 1);
      try { result = await resolver.resolve({ ...input, searchProgress: checkpoint }); }
      catch (error) {
        if (!(error instanceof PublicDiscoverySearchContinuationError)) throw error;
        checkpoint = error.searchProgress;
      }
      expect(callsInInvocation).toBe(2);
      if (passage === 0) expect(checkpoint).toMatchObject({ provider: 'mangadex', titleIndex: 2, cursor: '1' });
    }
    expect(result).toEqual({ reason: 'all-provider-lanes-exhausted', state: 'NOT_FOUND' });
    expect(searched).toHaveLength(12);
    expect(new Set(searched).size).toBe(12);
  });

  it('keeps the two-successful-search budget after an earlier provider failure', async () => {
    const fallbackSearch = vi.fn(async () => ({ candidates: [], complete: true, digest: 'empty', provider: 'kitsu-manga' as const, truncated: false }));
    const unavailable = { hydrate: async () => undefined, search: async () => { throw new Error('HTTP 503'); } };
    const providers: PublicDiscoveryProviderPorts = { anilist: unavailable, mangaupdates: unavailable, mangadex: unavailable,
      'kitsu-anime': unavailable, 'kitsu-manga': { ...unavailable, search: fallbackSearch } };
    const resolver = createBudgetedDiscoveryResolver(providers, () => 0, () => 1);
    await expect(resolver.resolve({ attempt: 1,
      key: { fingerprint: 'a'.repeat(64), mediaKind: 'MANGA', parserVersion: 'parser-v1', siteRulesVersion: 'rules-v1' },
      query: { discoveryTitles: ['Alpha', 'Beta', 'Gamma'], mediaKind: 'MANGA', sourceTitles: ['Alpha'] },
      requestDigest: 'b'.repeat(64), schemaVersion: 3,
    })).rejects.toMatchObject({ searchProgress: { provider: 'kitsu-manga', titleIndex: 2, retryProviders: ['mangadex'] } });
    expect(fallbackSearch).toHaveBeenCalledTimes(2);
  });

  it('routes an operational recovery signal without invoking collectors or resetting requests', async () => {
    const item = message({ type: 'agenda-recovery', version: 1 });
    const processors = { agenda: vi.fn(), discovery: vi.fn(), recovery: vi.fn(async () => undefined) };
    await handleNativeCollectorQueue([item], processors);
    expect(processors.recovery).toHaveBeenCalledOnce();
    expect(processors.agenda).not.toHaveBeenCalled();
    expect(processors.discovery).not.toHaveBeenCalled();
    expect(item.ack).toHaveBeenCalledOnce();
    expect(item.retry).not.toHaveBeenCalled();
  });

  it('acknowledges a malformed signal without invoking a processor', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const item = message(null);
    const agenda = vi.fn(); const discovery = vi.fn();
    await handleNativeCollectorQueue([item], { agenda, discovery });
    expect(item.ack).toHaveBeenCalledOnce(); expect(item.retry).not.toHaveBeenCalled(); expect(agenda).not.toHaveBeenCalled(); expect(discovery).not.toHaveBeenCalled();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ code: 'collector-signal-invalid', disposition: 'ack-invalid', messageType: 'invalid' });
  });

  it('acknowledges a successful discovery signal', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const item = message({ type: 'public-discovery-ready', version: 1 });
    await handleNativeCollectorQueue([item], { agenda: vi.fn(), discovery: async () => ({ claimed: 1, failed: 0, published: 1, replayed: 0 }) });
    expect(item.ack).toHaveBeenCalledOnce(); expect(item.retry).not.toHaveBeenCalled();
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({ disposition: 'ack-success', messageType: 'public-discovery-ready' });
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toEqual({
      acceptedResults: 0, d1RowsRead: 0, d1RowsWritten: 0, durationMs: expect.any(Number),
      pagesRequested: 0, provider: 'none', providerRequests: 0, result: 'unchanged', retries: 0,
      providerTransportDurationMs: 0, provider429s: 0, providerHttpErrors: 0, providerNetworkErrors: 0,
      r2Reads: 0, r2Writes: 0, r2Lists: 0, r2Conflicts: 0,
      queueSends: 0, queueFailures: 0,
      schemaVersion: 1, task: 'discovery', type: 'worker.cost',
    });
  });

  it('coalesces a Queue batch into one discovery claim and acknowledges duplicate signals', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const items = Array.from({ length: 20 }, () => message({ type: 'public-discovery-ready', version: 1 }));
    const discovery = vi.fn(async () => ({ claimed: 20, failed: 0, published: 20, replayed: 0 }));

    await handleNativeCollectorQueue(items, { agenda: vi.fn(), discovery });

    expect(discovery).toHaveBeenCalledOnce();
    for (const item of items) {
      expect(item.ack).toHaveBeenCalledOnce();
      expect(item.retry).not.toHaveBeenCalled();
    }
  });

  it('retries a failed leased discovery after lease expiry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const item = message({ type: 'public-discovery-ready', version: 1 });
    await handleNativeCollectorQueue([item], { agenda: vi.fn(), discovery: async () => ({ claimed: 1, failed: 1, published: 0, replayed: 0 }) });
    expect(item.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 900 }); expect(item.ack).not.toHaveBeenCalled();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ code: 'public-discovery-partial', disposition: 'retry', retryDelaySeconds: 900 });
  });

  it('preserves an opaque admission correlation through the Queue cost', async () => {
    const correlationId = '00000000-0000-4000-8000-000000000001';
    const continuationToken = 'a'.repeat(43);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const item = message({ continuationToken, correlationId, type: 'public-discovery-ready', version: 1 });
    const discovery = vi.fn(async () => ({ claimed: 1, failed: 0, published: 1, replayed: 0 }));
    await handleNativeCollectorQueue([item], { agenda: vi.fn(), discovery });
    expect(discovery).toHaveBeenCalledExactlyOnceWith(correlationId, continuationToken);
    expect(JSON.parse(String(info.mock.calls[0]?.[0]))).toMatchObject({ correlationId, task: 'discovery' });
    expect(item.ack).toHaveBeenCalledOnce();
  });

  it('preserves the admission correlation when Queue processing throws', async () => {
    const correlationId = '00000000-0000-4000-8000-000000000019';
    const continuationToken = 'b'.repeat(43);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const item = message({ continuationToken, correlationId, type: 'public-discovery-ready', version: 1 });
    await handleNativeCollectorQueue([item], { agenda: vi.fn(), discovery: async () => { throw new Error('private upstream failure'); } });
    expect(item.retry).toHaveBeenCalledOnce();
    const costs = info.mock.calls.map(([entry]) => JSON.parse(String(entry))).filter(entry => entry.type === 'worker.cost');
    expect(costs).toHaveLength(1);
    expect(costs[0]).toMatchObject({ correlationId, result: 'failed', task: 'discovery' });
    expect(JSON.stringify([...info.mock.calls, ...warn.mock.calls])).not.toContain('private upstream failure');
  });

  it('runs only the first signal group and forwards the others before acknowledging them', async () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const discoveryItem = message({ type: 'public-discovery-ready', version: 1 });
    const agendaItems = Array.from({ length: 2 }, () => message({ scheduledFor: '2026-09-23T00:00:00.000Z', type: 'agenda-refresh', version: 1 }));
    const recoveryItem = message({ type: 'agenda-recovery', version: 1 });
    const forward = vi.fn(async () => {
      expect(recoveryItem.ack).not.toHaveBeenCalled();
    }).mockImplementationOnce(async () => {
      expect(agendaItems.every(item => item.ack.mock.calls.length === 0)).toBe(true);
    });
    const processors = { agenda: vi.fn(), recovery: vi.fn(), forward,
      discovery: vi.fn(async () => ({ claimed: 1, failed: 0, published: 1, replayed: 0 })) };

    await handleNativeCollectorQueue([discoveryItem, ...agendaItems, recoveryItem], processors);

    expect(processors.discovery).toHaveBeenCalledOnce();
    expect(processors.agenda).not.toHaveBeenCalled();
    expect(processors.recovery).not.toHaveBeenCalled();
    expect(forward.mock.calls).toEqual([[agendaItems[0]!.body], [recoveryItem.body]]);
    for (const item of [discoveryItem, ...agendaItems, recoveryItem]) {
      expect(item.ack).toHaveBeenCalledOnce(); expect(item.retry).not.toHaveBeenCalled();
    }
    expect(info.mock.calls.map(([entry]) => JSON.parse(String(entry)))).toContainEqual(expect.objectContaining({ disposition: 'ack-forwarded', messageType: 'agenda-refresh' }));
  });

  it('coalesces identical Agenda signals without dropping another scheduled generation', async () => {
    const items = Array.from({ length: 2 }, () => message({ scheduledFor: '2026-09-23T00:00:00.000Z', type: 'agenda-refresh', version: 1 }));
    const next = message({ scheduledFor: '2026-09-24T00:00:00.000Z', type: 'agenda-refresh', version: 1 });
    const discovery = message({ type: 'public-discovery-ready', version: 1 });
    const agenda = vi.fn(async () => ({ changed: false, count: 0, revision: 'unchanged' }));
    const processors = { agenda, discovery: vi.fn(), forward: vi.fn(async () => undefined) };
    await handleNativeCollectorQueue([...items, next, discovery], processors);
    expect(agenda).toHaveBeenCalledExactlyOnceWith('2026-09-23T00:00:00.000Z');
    expect(processors.discovery).not.toHaveBeenCalled();
    expect(processors.forward.mock.calls).toEqual([[next.body], [discovery.body]]);
    for (const item of [...items, next, discovery]) expect(item.ack).toHaveBeenCalledOnce();
  });

  it('keeps one retryable signal when forwarding fails and never starts another collector', async () => {
    const selected = message({ type: 'agenda-recovery', version: 1 });
    const deferred = Array.from({ length: 2 }, () => message({ type: 'public-discovery-ready', version: 1 }));
    const processors = { agenda: vi.fn(), discovery: vi.fn(), recovery: vi.fn(async () => undefined),
      forward: vi.fn(async () => { throw new Error('queue-unavailable'); }) };
    await handleNativeCollectorQueue([selected, ...deferred], processors);
    expect(processors.recovery).toHaveBeenCalledOnce();
    expect(processors.discovery).not.toHaveBeenCalled();
    expect(deferred[0]!.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 60 });
    expect(deferred[0]!.ack).not.toHaveBeenCalled();
    expect(deferred[1]!.ack).toHaveBeenCalledOnce();
    expect(selected.ack).toHaveBeenCalledOnce();
  });

  it('runs Agenda and applies bounded exponential retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const item = message({ scheduledFor: '2026-09-15T14:00:00.000Z', type: 'agenda-refresh', version: 1 }, 3);
    await handleNativeCollectorQueue([item], { agenda: async () => { throw new Error('upstream'); }, discovery: vi.fn() });
    expect(item.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 240 }); expect(item.ack).not.toHaveBeenCalled();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ code: 'collector-internal', disposition: 'retry', messageType: 'agenda-refresh' });
  });

  it.each([
    [new Error('D1_ERROR: private title https://private.example/secret'), 'collector-d1'],
    [new TypeError('private title https://private.example/secret'), 'collector-type-error'],
  ])('logs only the closed collector code %s', async (failure, expectedCode) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const item = message({ scheduledFor: '2026-09-15T14:00:00.000Z', type: 'agenda-refresh', version: 1 });

    await handleNativeCollectorQueue([item], { agenda: async () => { throw failure; }, discovery: vi.fn() });

    const event = JSON.parse(String(warn.mock.calls[0]?.[0]));
    expect(event).toMatchObject({ code: expectedCode, disposition: 'retry', messageType: 'agenda-refresh' });
    expect(JSON.stringify(event)).not.toMatch(/private|https|secret/iu);
  });

  it('uses an Agenda provider Retry-After delay instead of generic backoff', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const item = message({ scheduledFor: '2026-09-15T14:00:00.000Z', type: 'agenda-refresh', version: 1 }, 3);
    await handleNativeCollectorQueue([item], { agenda: async () => { throw new AgendaCollectionRetryError('agenda-mangaupdates-unavailable', 1_200); }, discovery: vi.fn() });
    expect(item.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 1_200 });
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ code: 'agenda-mangaupdates-unavailable', retryDelaySeconds: 1_200 });
  });

  it('marks the configured final attempt as destined for the DLQ', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const item = message({ scheduledFor: '2026-09-15T14:00:00.000Z', type: 'agenda-refresh', version: 1 }, 9);
    await handleNativeCollectorQueue([item], { agenda: async () => { throw new Error('agenda-anilist-unavailable'); }, discovery: vi.fn() });
    expect(item.retry).toHaveBeenCalledExactlyOnceWith({ delaySeconds: 3_600 });
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({ attempt: 9, code: 'agenda-anilist-unavailable', disposition: 'retry-to-dlq' });
  });

  it('reduces lane failures to bounded provider-specific codes', () => {
    expect(agendaCollectionFailureCode(['anilist:HTTP 403'])).toBe('agenda-anilist-unavailable');
    expect(agendaCollectionFailureCode(['mangaupdates:timeout'])).toBe('agenda-mangaupdates-unavailable');
    expect(agendaCollectionFailureCode(['anilist:HTTP 403', 'mangaupdates:timeout'])).toBe('agenda-anilist-mangaupdates-unavailable');
    expect(agendaCollectionFailureCode(['unknown:raw upstream payload'])).toBe('agenda-provider-unavailable');
  });

  it('keeps paginated pages distinct from provider HTTP requests', () => {
    expect(collectorCost({ rowsRead: 0, rowsWritten: 0 }, { anilist: 3, kitsu: 0, mangadex: 0, mangaupdates: 0,
      providerTransportDurationMs: 50, provider429s: 0, providerHttpErrors: 0, providerNetworkErrors: 0 }, 2, 'changed', 2))
      .toMatchObject({ pagesRequested: 2, providerRequests: 3, provider: 'anilist' });
  });

  it.each(['success', '429', 'network'] as const)('retains measured %s provider outcomes in the final collector event', async (outcome) => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    let clock = 0;
    const provider = instrumentProviderFetch(async () => {
      clock += 25;
      if (outcome === 'network') throw new Error('private upstream detail');
      return new Response('private payload', { status: outcome === '429' ? 429 : 200 });
    }, () => clock);
    await provider.fetch('https://graphql.anilist.co', {}).catch(() => undefined);
    const metrics = collectorCost({ rowsRead: 2, rowsWritten: 0 }, provider.snapshot(), outcome === 'success' ? 1 : 0, outcome === 'success' ? 'changed' : 'backoff');
    if (outcome === 'network') {
      const item = message({ scheduledFor: '2026-09-23T00:00:00.000Z', type: 'agenda-refresh', version: 1 });
      await handleNativeCollectorQueue([item], {
        agenda: async () => { throw new AgendaCollectionRetryError('agenda-anilist-unavailable', 60, metrics); }, discovery: vi.fn(),
      });
      expect(item.retry).toHaveBeenCalledOnce();
    } else {
      const item = message({ type: 'public-discovery-ready', version: 1 });
      await handleNativeCollectorQueue([item], { agenda: vi.fn(), discovery: async () => ({
        claimed: 1, failed: 0, published: outcome === 'success' ? 1 : 0, replayed: 0, continuationScheduled: true, metrics,
      }) });
      expect(item.ack).toHaveBeenCalledOnce();
    }
    expect(info).toHaveBeenCalledOnce();
    const event = JSON.parse(String(info.mock.calls[0]?.[0]));
    expect(event).toMatchObject({ provider: 'anilist', providerRequests: 1, providerTransportDurationMs: 25,
      provider429s: outcome === '429' ? 1 : 0, providerHttpErrors: outcome === '429' ? 1 : 0,
      providerNetworkErrors: outcome === 'network' ? 1 : 0, d1RowsRead: 2 });
    expect(JSON.stringify(event)).not.toMatch(/private|https|payload|upstream/iu);
  });

  it('turns a hung discovery resolution into a retryable provider delay', async () => {
    await expect(resolveWithDeadline(new Promise<never>(() => undefined), 1))
      .rejects.toMatchObject({ name: 'Error', retryAt: expect.any(Number) });
  });
});
