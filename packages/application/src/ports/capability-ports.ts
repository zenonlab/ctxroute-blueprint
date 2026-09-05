import type { WorkId } from '@tobirink/domain';

export interface BookmarkRecord {
  bookmarkId: string;
  title: string;
  url: string;
}

export interface BookmarkPort {
  importBookmarks(): Promise<readonly BookmarkRecord[]>;
  projectWork(input: { bookmarkId?: string; title: string; url: string; workId: WorkId }): Promise<string>;
}

export interface BootstrapEnvelope {
  backupLocator?: string;
  generation: number;
  schemaVersion: number;
  wrappedKey?: string;
}

export interface BootstrapPort {
  loadEnvelope(): Promise<BootstrapEnvelope | undefined>;
  saveEnvelope(envelope: BootstrapEnvelope): Promise<void>;
}

export interface CatalogueRecord {
  mediaKind: 'anime' | 'manga';
  preferredTitle: string;
  workId: WorkId;
}

export interface CataloguePort {
  findWork(workId: WorkId): Promise<CatalogueRecord | undefined>;
}

export interface MediaPort {
  coverUrl(workId: WorkId, variant: 'cover-lg' | 'cover-md' | 'cover-sm'): Promise<string | undefined>;
}

export interface NotificationPort {
  publish(input: { body: string; deduplicationKey: string; title: string }): Promise<void>;
}

export interface PageContextPort {
  readActivePage(): Promise<{ title: string; url: string } | undefined>;
}

export interface TelemetryEvent {
  fields?: Readonly<Record<string, boolean | number | string>>;
  name: string;
}

export interface TelemetryPort {
  record(event: TelemetryEvent): void;
}

export interface ClockPort {
  now(): string;
}
