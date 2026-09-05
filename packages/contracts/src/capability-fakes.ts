import type {
  BookmarkPort,
  BookmarkRecord,
  BootstrapEnvelope,
  BootstrapPort,
  CataloguePort,
  CatalogueRecord,
  ClockPort,
  MediaPort,
  NotificationPort,
  PageContextPort,
  TelemetryEvent,
  TelemetryPort,
} from '@tobirink/application';
import type { WorkId } from '@tobirink/domain';

export class FixedClock implements ClockPort {
  constructor(private readonly value: string) {}
  now() { return this.value; }
}

export class MemoryTelemetry implements TelemetryPort {
  readonly events: TelemetryEvent[] = [];
  record(event: TelemetryEvent) { this.events.push(event); }
}

export class FakeBookmarkPort implements BookmarkPort {
  readonly projected: Array<{ bookmarkId?: string; title: string; url: string; workId: WorkId }> = [];
  constructor(readonly bookmarks: readonly BookmarkRecord[] = []) {}
  async importBookmarks() { return this.bookmarks; }
  async projectWork(input: { bookmarkId?: string; title: string; url: string; workId: WorkId }) {
    this.projected.push(input);
    return input.bookmarkId ?? `bookmark_${this.projected.length}`;
  }
}

export class MemoryBootstrapPort implements BootstrapPort {
  envelope?: BootstrapEnvelope;
  async loadEnvelope() { return this.envelope; }
  async saveEnvelope(envelope: BootstrapEnvelope) { this.envelope = envelope; }
}

export class FakeCataloguePort implements CataloguePort {
  constructor(private readonly records: readonly CatalogueRecord[] = []) {}
  async findWork(workId: WorkId) { return this.records.find((record) => record.workId === workId); }
}

export class FakeMediaPort implements MediaPort {
  async coverUrl(workId: WorkId, variant: 'cover-lg' | 'cover-md' | 'cover-sm') { return `https://media.invalid/${workId}/${variant}`; }
}

export class FakeNotificationPort implements NotificationPort {
  readonly published: Array<{ body: string; deduplicationKey: string; title: string }> = [];
  async publish(input: { body: string; deduplicationKey: string; title: string }) { this.published.push(input); }
}

export class FakePageContextPort implements PageContextPort {
  constructor(private readonly page?: { title: string; url: string }) {}
  async readActivePage() { return this.page; }
}
