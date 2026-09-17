import type { FavoritePublicReference } from '../favorites/favorite-identity-lookup';

export interface PublicCatalogueWork {
  id: string;
  mediaKind: 'anime' | 'manga';
  metadata?: {
    categories: readonly string[];
    chapterTotal?: number;
    contentClassification: 'adult' | 'non-adult' | 'unknown';
    cover?: { attribution: string; url: string };
    editorialStatus?: 'UPCOMING' | 'ONGOING' | 'HIATUS' | 'COMPLETED' | 'CANCELLED' | 'UNKNOWN';
    endYear?: number;
    episodeTotal?: number;
    format?: string;
    genres: readonly string[];
    source: { externalId: string; observedAt: string; provider: string; version: number };
    startYear?: number;
    volumeTotal?: number;
  };
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
  searchWorksByTitle(title: string, limit: number): Promise<readonly PublicCatalogueWork[]>;
}

export interface CoverMasterReadPort {
  findMaster?(reference: FavoritePublicReference): Promise<{ digest: string; extension: 'avif' | 'jpg' | 'png' | 'webp' } | undefined>;
  readMaster(key: string): Promise<ReadableStream<Uint8Array> | undefined>;
}

export type CoverOutputFormat = 'image/avif' | 'image/jpeg' | 'image/png' | 'image/webp';

export type CoverRightsBasis = 'licensed' | 'public-domain';

export interface NormalizedCoverMaster {
  publicReference?: FavoritePublicReference;
  attribution?: string;
  bytes: Uint8Array;
  colorSpace: 'srgb';
  contentType: CoverOutputFormat;
  height: number;
  metadataStripped: true;
  orientationNormalized: true;
  rights: {
    basis: CoverRightsBasis;
    policyId: string;
  };
  sourceUrl: string;
  width: number;
}

export interface StoredCoverMaster {
  contentType: CoverOutputFormat;
  created: boolean;
  digest: string;
  height: number;
  key: string;
  width: number;
}

export interface CoverMasterIngestionPort {
  ingest(master: NormalizedCoverMaster): Promise<StoredCoverMaster>;
}

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

export interface PublicReleaseArtifactRecord {
  body: ReadableStream<Uint8Array>;
  contentType: string;
  etag: string;
}

export interface PublicReleaseObjectPort {
  readPointer(key: string): Promise<PublicReleasePointerRecord | undefined>;
  readSnapshot(key: string): Promise<PublicReleaseSnapshotRecord | undefined>;
  readArtifact(key: string): Promise<PublicReleaseArtifactRecord | undefined>;
}
