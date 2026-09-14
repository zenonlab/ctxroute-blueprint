import { publicDiscoveryClaimBatchSchema, publicDiscoveryReceiptSchema } from './contracts.js';
import type { PublicDiscoveryResultBatch } from './contracts.js';
import type { PublicDiscoveryGatewayPort } from './collector.js';

export interface PublicDiscoveryHttpGatewayOptions {
  readonly baseUrl: string;
  readonly claimToken: string;
  readonly fetcher?: typeof fetch;
  readonly resultToken: string;
}

const responseByteLimit = 64 * 1024;
type DiscoveryRequestBody = Readonly<{ limit: number }> | PublicDiscoveryResultBatch;

async function boundedJsonText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > responseByteLimit) throw new Error('discovery-response-too-large');
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error('discovery-response-empty');
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false });
  let bytes = 0; let text = '';
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > responseByteLimit) throw new Error('discovery-response-too-large');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
  return text;
}

function endpoint(baseUrl: string, path: string): string {
  const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') throw new TypeError('discovery API must use HTTPS');
  return url.href;
}

export function createPublicDiscoveryHttpGateway(options: PublicDiscoveryHttpGatewayOptions): PublicDiscoveryGatewayPort {
  const fetcher = options.fetcher ?? fetch.bind(globalThis);
  const request = async (path: string, token: string, body: DiscoveryRequestBody): Promise<Response> => {
    const response = await fetcher(endpoint(options.baseUrl, path), {
      body: JSON.stringify(body),
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      method: 'POST',
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`discovery-api-${response.status}`);
    return response;
  };
  return {
    async claim(limit) {
      return publicDiscoveryClaimBatchSchema.parse(JSON.parse(await boundedJsonText(await request('/v3/catalogue/discoveries/collector/claims', options.claimToken, { limit }))));
    },
    async publish(batch) {
      return publicDiscoveryReceiptSchema.parse(JSON.parse(await boundedJsonText(await request('/v3/catalogue/discoveries/results', options.resultToken, batch))));
    },
  };
}
