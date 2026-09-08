import { extractFavoriteSourceEvidence } from '@tobirink/application';
import { describe, expect, it } from 'vitest';
import { mangaUpdatesSourceAdapter } from './mangaupdates-source-adapter';

function evidence(url: string) {
  return extractFavoriteSourceEvidence({ sourceKey: 'bookmark-mangaupdates', title: 'Fixture MangaUpdates', url }, [mangaUpdatesSourceAdapter]);
}

describe('MangaUpdates exact-origin source adapter', () => {
  it.each(['https://www.mangaupdates.com/series/abc123/Fixture-Series', 'http://mangaupdates.com/series/Z9'])('extracts an exact ASCII series ID from %s', (url) => {
    expect(evidence(url)).toMatchObject({ explicitProviderReference: { provider: 'mangaupdates' }, mediaKind: 'MANGA', strategy: 'exact-origin' });
  });

  it('canonicalizes the work URL without inventing a title', () => {
    expect(evidence('https://www.mangaupdates.com/series/abc123')).toMatchObject({ canonicalUrl: 'https://www.mangaupdates.com/series/abc123', explicitProviderReference: { externalId: '623698779' } });
    expect(evidence('https://www.mangaupdates.com/series/abc123').title).toBeUndefined();
  });

  it.each(['https://fake.mangaupdates.com/series/abc123', 'https://www.mangaupdates.com/releases/abc123', 'https://www.mangaupdates.com/series/a-b', 'https://www.mangaupdates.com/series/abc123/title/extra'])('rejects non-exact MangaUpdates identity %s', (url) => {
    expect(evidence(url).explicitProviderReference).toBeUndefined();
  });
});
