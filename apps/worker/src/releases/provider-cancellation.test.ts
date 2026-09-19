import { applyD1Migrations, env } from 'cloudflare:test';
import { expect, it } from 'vitest';
import { R2AgendaOperationStore } from '@tobirink/adapters-cloudflare';
import { AniListReleaseCollector, D1AgendaCollectionAdapter } from './public-release-collectors';
import { D1PublicReleaseCalendarAdapter } from './public-release-calendar';

it('carries a raw provider cancellation through the R2 checkpoint and D1, then accepts a dated resumption', async () => {
  await applyD1Migrations(env.PUBLIC_DB, env.TEST_MIGRATIONS);
  await env.PUBLIC_DB.batch([
    env.PUBLIC_DB.prepare("INSERT INTO catalogue_revisions(revision, published_at) VALUES (989898, '2026-09-12T00:00:00.000Z')"),
    env.PUBLIC_DB.prepare("INSERT INTO catalogue_works(work_id, media_kind, preferred_title, revision) VALUES ('work_provider_cancel', 'anime', 'Provider cancellation', 989898)"),
    env.PUBLIC_DB.prepare("INSERT INTO catalogue_external_references(provider, external_id, work_id) VALUES ('anilist', '988888', 'work_provider_cancel')"),
  ]);
  const operations = new R2AgendaOperationStore(env.RELEASE_SNAPSHOTS, 'provider-cancellation');
  const writer = new D1AgendaCollectionAdapter(env.PUBLIC_DB, operations);
  const reader = new D1PublicReleaseCalendarAdapter(env.PUBLIC_DB, operations);
  const window = { from: '2026-09-12', to: '2026-10-01' };
  const publish = async (status: 'CANCELLED' | 'RELEASING', now: string, release: string) => {
    const admission = await writer.claimLane({ collectionId: status, provider: 'anilist', scheduledFor: now, now, leaseUntil: new Date(Date.parse(now) + 3_600_000).toISOString(), tokenDigest: status.padEnd(64, '0'), window });
    if (admission.status !== 'claimed') throw new Error('Expected collection lease.');
    const fetcher = async () => Response.json({ data: { Page: { pageInfo: { hasNextPage: false }, airingSchedules: [{ airingAt: Date.parse(release) / 1000, episode: 1, media: { id: 988888, status } }] } } });
    await new AniListReleaseCollector(fetcher, async () => undefined, checkpoint => writer.savePage(admission.claim, checkpoint, now), () => Date.parse(now)).collect(window);
    await writer.completeLane({ checkedAt: now, claim: admission.claim, provider: 'anilist', scheduledFor: now });
    await writer.publishMergedGeneration(now);
  };
  await publish('CANCELLED', '2026-09-12T00:00:00.000Z', '2026-09-13T12:00:00.000Z');
  expect((await reader.query({ ...window, limit: 100 })).entries).toMatchObject([{ state: 'CANCELLED', providerWorkId: '988888' }]);
  await publish('RELEASING', '2026-09-19T00:00:00.000Z', '2026-09-20T12:00:00.000Z');
  expect((await reader.query({ ...window, limit: 100 })).entries).toMatchObject([{ state: 'SCHEDULED', occurrence: { value: '2026-09-20T12:00:00.000Z' } }]);
  expect(await operations.readPageVersion('snapshots/anilist/CANCELLED')).toMatchObject({ events: [{ state: 'CANCELLED' }] });
});
