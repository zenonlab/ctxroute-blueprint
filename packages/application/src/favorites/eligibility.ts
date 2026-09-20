import { favoriteUrlByteLimit, utf8ByteLength } from '@tobirink/domain';
import type { FavoriteUrlDisposition } from '@tobirink/domain';

const utilitySegments = new Set([
  'account', 'genre', 'genres', 'index.html', 'index.php',
  'login', 'profile', 'search', 'settings', 'tag', 'tags',
]);
const mediaSegments = new Set(['anime', 'manga', 'manhua', 'manhwa', 'webtoon']);

export interface EligibleFavoriteUrl {
  readonly decodedSegments: readonly string[];
  readonly host: string;
  readonly kind: 'ELIGIBLE';
  readonly origin: string;
  readonly pathname: string;
  readonly rawSegments: readonly string[];
  readonly url: string;
}

export interface RejectedFavoriteUrl {
  readonly disposition: FavoriteUrlDisposition;
  readonly kind: 'REJECTED';
  readonly url: string;
}

export type FavoriteUrlQualification = EligibleFavoriteUrl | RejectedFavoriteUrl;

function rejected(url: string, disposition: FavoriteUrlDisposition): RejectedFavoriteUrl {
  return Object.freeze({ disposition, kind: 'REJECTED', url });
}

function decodeSegment(segment: string): string {
  try { return decodeURIComponent(segment); } catch { return segment; }
}

export function qualifyFavoriteUrl(rawUrl: string): FavoriteUrlQualification {
  if (utf8ByteLength(rawUrl) > favoriteUrlByteLimit) throw new RangeError(`url exceeds ${favoriteUrlByteLimit} UTF-8 bytes.`);
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return rejected(rawUrl, 'INVALID_URL'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return rejected(rawUrl, 'NON_WEB_URL');
  const rawSegments = parsed.pathname.split('/').filter(Boolean);
  if (rawSegments.length === 0) return rejected(rawUrl, 'ROOT_PAGE');
  const decodedSegments = rawSegments.map(decodeSegment);
  const normalizedSegments = decodedSegments.map((segment) => segment.toLowerCase());
  if (normalizedSegments.length === 1 && ['catalog', 'catalogue'].includes(normalizedSegments[0] ?? '')) return rejected(rawUrl, 'UTILITY_PAGE');
  const publicIndexMediaRoute = normalizedSegments[0] === 'public' && normalizedSegments[1] === 'index.php' && mediaSegments.has(normalizedSegments[2] ?? '');
  if (normalizedSegments.some((segment) => utilitySegments.has(segment)) && !publicIndexMediaRoute) return rejected(rawUrl, 'UTILITY_PAGE');
  if (normalizedSegments.some(segment => ['news', 'blog', 'shorts'].includes(segment))) return rejected(rawUrl, 'URL_IDENTITY_UNRESOLVED');
  if (normalizedSegments.includes('drama') && !normalizedSegments.some((segment) => mediaSegments.has(segment))) {
    return rejected(rawUrl, 'URL_IDENTITY_UNRESOLVED');
  }
  return Object.freeze({
    decodedSegments: Object.freeze(decodedSegments),
    host: parsed.hostname.toLowerCase(),
    kind: 'ELIGIBLE',
    origin: parsed.origin,
    pathname: parsed.pathname,
    rawSegments: Object.freeze(rawSegments),
    url: rawUrl,
  });
}
