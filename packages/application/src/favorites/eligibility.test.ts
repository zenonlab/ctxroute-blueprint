import { describe, expect, it } from 'vitest';
import { qualifyFavoriteUrl } from './eligibility';

describe('favorite URL eligibility', () => {
  it.each([
    ['not a URL', 'INVALID_URL'],
    ['ftp://fixtures.tobirink.invalid/anime/frieren', 'NON_WEB_URL'],
    ['https://fixtures.tobirink.invalid/', 'ROOT_PAGE'],
    ['https://fixtures.tobirink.invalid/catalogue/', 'UTILITY_PAGE'],
    ['https://fixtures.tobirink.invalid/index.php', 'UTILITY_PAGE'],
    ['https://fixtures.tobirink.invalid/search/frieren', 'UTILITY_PAGE'],
    ['https://fixtures.tobirink.invalid/drama/frieren', 'URL_IDENTITY_UNRESOLVED'],
    ['https://fixtures.tobirink.invalid/drama/series/frieren', 'URL_IDENTITY_UNRESOLVED'],
  ] as const)('rejects %s with %s', (url, disposition) => {
    expect(qualifyFavoriteUrl(url)).toEqual({ disposition, kind: 'REJECTED', url });
  });

  it('decodes each segment independently and keeps an undecodable segment raw', () => {
    const result = qualifyFavoriteUrl('https://fixtures.tobirink.invalid/anime/Frieren%20Journey/%E0%A4%A');
    expect(result).toMatchObject({ decodedSegments: ['anime', 'Frieren Journey', '%E0%A4%A'], kind: 'ELIGIBLE' });
  });

  it('bounds URL work before parsing', () => {
    expect(() => qualifyFavoriteUrl(`https://fixtures.tobirink.invalid/${'a'.repeat(32 * 1024)}`)).toThrow(/32768 UTF-8 bytes/u);
  });
});
