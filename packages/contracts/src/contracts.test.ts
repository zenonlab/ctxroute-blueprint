import { describe, expect, it } from 'vitest';
import {
  FakeBookmarkPort,
  FakeCataloguePort,
  FakeMediaPort,
  FakeNotificationPort,
  FakePageContextPort,
  FixedClock,
  MemoryBootstrapPort,
  MemoryStoragePort,
  MemoryTelemetry,
  verifyStoragePortContract,
} from './index';
import { workId } from '@tobirink/domain';

describe('owned port contracts', () => {
  it('passes the shared StoragePort contract with the in-memory fake', async () => {
    await verifyStoragePortContract(() => new MemoryStoragePort());
  });

  it('provides observable fakes for every external capability port', async () => {
    const id = workId('work_capability');
    const bookmarks = new FakeBookmarkPort([]);
    const bootstrap = new MemoryBootstrapPort();
    const catalogue = new FakeCataloguePort([{ mediaKind: 'manga', preferredTitle: 'Frieren', workId: id }]);
    const clock = new FixedClock('2026-09-04T08:00:00.000Z');
    const media = new FakeMediaPort();
    const notifications = new FakeNotificationPort();
    const page = new FakePageContextPort({ title: 'Frieren', url: 'https://example.invalid/frieren' });
    const telemetry = new MemoryTelemetry();

    await bootstrap.saveEnvelope({ generation: 1, schemaVersion: 1 });
    await notifications.publish({ body: 'Disponible', deduplicationKey: 'release_1', title: 'Frieren' });
    telemetry.record({ name: 'local.operation', fields: { durationMs: 2 } });

    expect(await bookmarks.importBookmarks()).toEqual([]);
    expect((await catalogue.findWork(id))?.preferredTitle).toBe('Frieren');
    expect(await media.coverUrl(id, 'cover-sm')).toContain('cover-sm');
    expect(await page.readActivePage()).toEqual({ title: 'Frieren', url: 'https://example.invalid/frieren' });
    expect(await bootstrap.loadEnvelope()).toEqual({ generation: 1, schemaVersion: 1 });
    expect(clock.now()).toBe('2026-09-04T08:00:00.000Z');
    expect(notifications.published).toHaveLength(1);
    expect(telemetry.events).toHaveLength(1);
  });
});
