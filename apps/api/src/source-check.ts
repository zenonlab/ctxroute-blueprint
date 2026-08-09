import { safeRequest, type SafeHttpResponse } from '@favlib/safe-http';

export type SourceCheckResult = {
  status: 'AVAILABLE' | 'MOVED' | 'UNAVAILABLE';
  httpStatus: number | null;
  finalUrl: string | null;
  error: string | null;
};

export async function checkSourceUrl(
  url: string,
  request: (url: string) => Promise<Pick<SafeHttpResponse, 'status' | 'url'>> = (target) => safeRequest(target, {
    method: 'GET', maxRedirects: 3, timeoutMs: 5000, maxBytes: 512 * 1024,
    mimeTypes: [],
  }),
): Promise<SourceCheckResult> {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return { status: 'UNAVAILABLE', httpStatus: null, finalUrl: null, error: 'HTTP_PROTOCOL_REQUIRED' };
    }
    const response = await request(parsed.toString());
    return {
      status: response.status === 404 ? 'MOVED' : response.status >= 200 && response.status < 300 ? 'AVAILABLE' : 'UNAVAILABLE',
      httpStatus: response.status,
      finalUrl: response.url,
      error: response.status >= 200 && response.status < 300 || response.status === 404 ? null : `HTTP_${response.status}`,
    };
  } catch (error) {
    const raw = error instanceof Error ? error.message : 'NETWORK_UNAVAILABLE';
    const errorCode = /timeout|abort/i.test(raw) ? 'TIMEOUT' : /dns|ENOTFOUND|EAI_AGAIN/i.test(raw) ? 'DNS_UNAVAILABLE' : /tls|certificate/i.test(raw) ? 'TLS_UNAVAILABLE' : 'NETWORK_UNAVAILABLE';
    return { status: 'UNAVAILABLE', httpStatus: null, finalUrl: null, error: errorCode };
  }
}
