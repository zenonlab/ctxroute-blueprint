import { isAllowedProviderTarget, ProviderTransportResponseError } from './provider-transport-adapter';
import { z } from 'zod';

const providerExchangeByteLimit = 8 * 1024;
const providerExchangeCountLimit = 16;
const providerBodyReadTimeoutMilliseconds = 500;
const providerUserAgent = 'TobiRink/1.0 (+https://tobirink.com)';

export interface ProviderAuditExchange {
  readonly contentType?: string;
  readonly method: 'GET' | 'POST';
  readonly requestHeaders?: readonly { readonly name: 'accept' | 'content-type' | 'origin' | 'referer' | 'user-agent'; readonly value: string }[];
  readonly requestBody?: string;
  readonly responseHeaders?: readonly { readonly name: 'cf-ray' | 'ratelimit-limit' | 'ratelimit-remaining' | 'ratelimit-reset' | 'request-id' | 'retry-after' | 'x-ratelimit-limit' | 'x-ratelimit-remaining' | 'x-ratelimit-reset' | 'x-request-id'; readonly value: string }[];
  readonly responseBody?: string;
  readonly responseStatus?: number;
  readonly target: string;
  readonly transportFailure?: 'aborted' | 'network-error' | 'timeout';
  readonly truncated: boolean;
}

interface CapturedBody { readonly text?: string; readonly truncated: boolean }

function safeRequestHeaders(init: RequestInit): readonly { readonly name: 'accept' | 'content-type' | 'origin' | 'referer' | 'user-agent'; readonly value: string }[] {
  const headers = new Headers(init.headers);
  const safe: { name: 'accept' | 'content-type' | 'origin' | 'referer' | 'user-agent'; value: string }[] = [];
  const allowedHeaders = ['accept', 'content-type', 'origin', 'referer'] as const;
  for (const name of allowedHeaders) {
    const value = headers.get(name);
    if (value !== null) safe.push({ name, value: value.slice(0, 256) });
  }
  safe.push({ name: 'user-agent', value: providerUserAgent });
  return safe;
}

async function readBounded(stream: ReadableStream<Uint8Array> | null): Promise<CapturedBody> {
  if (stream === null) return { truncated: false };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let truncated = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<null>((resolve) => {
    timeoutHandle = setTimeout(() => resolve(null), providerBodyReadTimeoutMilliseconds);
  });
  try {
    while (size <= providerExchangeByteLimit) {
      const next = await Promise.race([reader.read(), timedOut]);
      if (next === null) {
        truncated = true;
        await reader.cancel();
        break;
      }
      if (next.done) break;
      const remaining = providerExchangeByteLimit + 1 - size;
      const chunk = next.value.subarray(0, remaining);
      chunks.push(chunk);
      size += chunk.byteLength;
      if (size > providerExchangeByteLimit) {
        truncated = true;
        await reader.cancel();
        break;
      }
    }
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(Math.min(size, providerExchangeByteLimit));
  let offset = 0;
  for (const chunk of chunks) {
    const copy = chunk.subarray(0, bytes.length - offset);
    bytes.set(copy, offset);
    offset += copy.byteLength;
    if (offset === bytes.length) break;
  }
  return { text: new TextDecoder().decode(bytes), truncated };
}

async function requestBodyText(body: BodyInit | null | undefined): Promise<CapturedBody> {
  if (body === null || body === undefined) return { truncated: false };
  const serialized = z.string().safeParse(body);
  if (serialized.success) return serialized.data.length > providerExchangeByteLimit
    ? { text: serialized.data.slice(0, providerExchangeByteLimit), truncated: true }
    : { text: serialized.data, truncated: false };
  if (body instanceof ReadableStream) return { truncated: true };
  return readBounded(new Response(body).body);
}

function safeResponseHeaders(response: Response): NonNullable<ProviderAuditExchange['responseHeaders']> {
  const names = ['cf-ray', 'ratelimit-limit', 'ratelimit-remaining', 'ratelimit-reset', 'request-id', 'retry-after',
    'x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset', 'x-request-id'] as const;
  const headers: { name: (typeof names)[number]; value: string }[] = [];
  for (const name of names) {
    const value = response.headers.get(name);
    if (value !== null) headers.push({ name, value: value.slice(0, 256) });
  }
  return headers;
}

function transportFailureKind(error: Error): NonNullable<ProviderAuditExchange['transportFailure']> {
  if (error instanceof Error && error.name === 'AbortError') return 'aborted';
  if (error instanceof Error && error.name === 'TimeoutError') return 'timeout';
  return 'network-error';
}

export function captureProviderFetch(
  fetcher: (input: string, init: RequestInit) => Promise<Response>,
  exchanges: ProviderAuditExchange[],
) {
  return async (input: string, init: RequestInit): Promise<Response> => {
    const method = z.enum(['GET', 'POST']).safeParse(init.method ?? 'GET');
    if (!method.success) return fetcher(input, init);
    const verb = method.data;
    if (exchanges.length >= providerExchangeCountLimit || !isAllowedProviderTarget(input, verb)) return fetcher(input, init);
    let request: CapturedBody;
    try { request = await requestBodyText(init.body); }
    catch { request = { truncated: true }; }
    const requestHeaders = safeRequestHeaders(init);
    let response: Response;
    try {
      response = await fetcher(input, init);
    } catch (error) {
      const rejectedResponse = error instanceof ProviderTransportResponseError ? error.response : undefined;
      let responseBody: CapturedBody | undefined;
      try { if (rejectedResponse !== undefined) responseBody = await readBounded(rejectedResponse.clone().body); }
      catch { responseBody = { truncated: true }; }
      const contentType = rejectedResponse?.headers.get('content-type')?.slice(0, 128);
      const responseHeaders = rejectedResponse === undefined ? undefined : safeResponseHeaders(rejectedResponse);
      const exchange: ProviderAuditExchange = {
        method: verb, target: input, truncated: request.truncated || (responseBody?.truncated ?? false),
      };
      if (requestHeaders.length > 0) Object.assign(exchange, { requestHeaders });
      if (request.text !== undefined) Object.assign(exchange, { requestBody: request.text });
      if (rejectedResponse !== undefined) Object.assign(exchange, { responseStatus: rejectedResponse.status });
      if (contentType !== null && contentType !== undefined) Object.assign(exchange, { contentType });
      if (responseBody?.text !== undefined) Object.assign(exchange, { responseBody: responseBody.text });
      if (responseHeaders !== undefined && responseHeaders.length > 0) Object.assign(exchange, { responseHeaders });
      if (rejectedResponse === undefined) Object.assign(exchange, { transportFailure: transportFailureKind(error instanceof Error ? error : new Error('provider-network-failure')) });
      exchanges.push(exchange);
      throw error;
    }
    let responseBody: CapturedBody;
    try { responseBody = await readBounded(response.clone().body); }
    catch { responseBody = { truncated: true }; }
    const contentType = response.headers.get('content-type')?.slice(0, 128);
    const responseHeaders = safeResponseHeaders(response);
    const exchange: ProviderAuditExchange = {
      method: verb,
      responseStatus: response.status,
      target: input,
      truncated: request.truncated || responseBody.truncated,
    };
    if (requestHeaders.length > 0) Object.assign(exchange, { requestHeaders });
    if (contentType !== null && contentType !== undefined) Object.assign(exchange, { contentType });
    if (responseHeaders.length > 0) Object.assign(exchange, { responseHeaders });
    if (request.text !== undefined) Object.assign(exchange, { requestBody: request.text });
    if (responseBody.text !== undefined) Object.assign(exchange, { responseBody: responseBody.text });
    exchanges.push(exchange);
    return response;
  };
}
