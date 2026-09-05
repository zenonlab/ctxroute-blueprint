export interface PublicCatalogueWork {
  id: string;
  mediaKind: 'anime' | 'manga';
  preferredTitle: string;
  revision: number;
}

export interface PublicCatalogueTitle {
  locale: string;
  title: string;
}

export interface PublicCatalogueReference {
  externalId: string;
  provider: string;
}

export interface PublicCatalogueReadPort {
  findWork(workId: string): Promise<PublicCatalogueWork | undefined>;
  listReferences(workId: string, limit: number): Promise<readonly PublicCatalogueReference[]>;
  listTitles(workId: string, limit: number): Promise<readonly PublicCatalogueTitle[]>;
  listWorksAfter(cursor: { id: string; revision: number }, limit: number): Promise<readonly PublicCatalogueWork[]>;
  resolveReference(provider: string, externalId: string): Promise<PublicCatalogueWork | undefined>;
}

export interface CoverMasterReadPort {
  readMaster(key: string): Promise<ReadableStream<Uint8Array> | undefined>;
}

export type CoverOutputFormat = 'image/avif' | 'image/jpeg' | 'image/png' | 'image/webp';

export interface CoverImageRenderPort {
  render(input: {
    body: ReadableStream<Uint8Array>;
    format: CoverOutputFormat;
    headers: HeadersInit;
    quality: number | undefined;
    transform: { fit: 'scale-down'; height: number; width: number };
  }): Promise<Response>;
}

export interface PublicReleasePointerRecord {
  revision: string;
}

export interface PublicReleaseEntryRecord {
  availability: 'confirmed' | 'estimated' | 'official';
  label: string;
  occursAt: string;
  releaseId: string;
  workId: string;
}

export interface PublicReleaseSnapshotRecord {
  entries: readonly PublicReleaseEntryRecord[];
  generatedAt: string;
  revision: string;
}

export interface PublicReleaseObjectPort {
  readPointer(key: string): Promise<PublicReleasePointerRecord | undefined>;
  readSnapshot(key: string): Promise<PublicReleaseSnapshotRecord | undefined>;
}
