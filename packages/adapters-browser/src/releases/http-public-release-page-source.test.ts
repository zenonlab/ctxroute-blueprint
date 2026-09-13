import { describe, expect, it, vi } from 'vitest';
import { HttpPublicReleasePageSource } from './http-public-release-page-source';

describe('HttpPublicReleasePageSource', () => {
  it('collects one AniList page and returns a durable continuation', async () => {
    const now = Date.parse('2026-09-12T00:00:00.000Z');
    const fetcher = vi.fn(async () => Response.json({ data: { Page: { airingSchedules: [{ airingAt: 1_789_171_200, episode: 4, media: { id: 42 } }], pageInfo: { hasNextPage: true } } } }));
    const page = await new HttpPublicReleasePageSource(fetcher, () => now).collectPage('anilist', 1, { from: '2026-09-12', to: '2026-10-17' });
    expect(page).toMatchObject({ complete: false, nextPage: 2, notBefore: now + 2_200, page: 1, provider: 'anilist' });
    expect(page.events[0]).toMatchObject({ providerWorkId: '42', sequence: '4', occurrence: { kind: 'INSTANT' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps MangaUpdates releases as civil dates and rejects retryable HTTP failures', async () => {
    const response = { page: 1, per_page: 40, total_hits: 1, results: [{ metadata: { series: { series_id: 77 } }, record: { chapter: '58.5', id: 9, release_date: '2026-09-12' } }] };
    const source = new HttpPublicReleasePageSource(async () => Response.json(response), () => Date.parse('2026-09-12T12:00:00.000Z'));
    await expect(source.collectPage('mangaupdates', 1, { from: '2026-09-12', to: '2026-10-17' })).resolves.toMatchObject({ complete: true, events: [{ occurrence: { kind: 'DATE', value: '2026-09-12' }, providerWorkId: '77', sequence: '58.5' }] });
    await expect(new HttpPublicReleasePageSource(async () => new Response(null, { status: 429 })).collectPage('mangaupdates', 1, { from: '2026-09-12', to: '2026-10-17' })).rejects.toThrow('public-release-provider-429');
  });
});
