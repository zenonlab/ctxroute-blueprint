export const COVER_CONTENT_TYPES = ['image/avif', 'image/jpeg', 'image/png', 'image/webp'] as const;

export type CoverContentType = (typeof COVER_CONTENT_TYPES)[number];
export type CoverRightsStatus = 'licensed' | 'public-domain';

export interface NormalizedCoverMaster {
  attribution?: string;
  bytes: Uint8Array;
  colorSpace: 'srgb';
  contentType: CoverContentType;
  height: number;
  metadataStripped: true;
  orientationNormalized: true;
  rightsStatus: CoverRightsStatus;
  sourceUrl: string;
  width: number;
}

interface StoredCoverObject {
  etag: string;
  key: string;
}

export interface CoverObjectStore {
  head(key: string): Promise<StoredCoverObject | null>;
  put(
    key: string,
    value: ArrayBufferView,
    options: {
      customMetadata: Record<string, string>;
      httpMetadata: { cacheControl: string; contentType: string };
      onlyIf: { etagDoesNotMatch: '*' };
      sha256: ArrayBufferView;
    },
  ): Promise<StoredCoverObject | null>;
}

export interface StoredCoverMaster {
  contentType: CoverContentType;
  created: boolean;
  digest: string;
  height: number;
  key: string;
  width: number;
}

const MAX_COVER_BYTES = 10 * 1024 * 1024;
const MAX_COVER_DIMENSION = 8192;
const EXTENSIONS: Record<CoverContentType, string> = {
  'image/avif': 'avif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function assertNormalizedMaster(master: NormalizedCoverMaster): void {
  if (!['licensed', 'public-domain'].includes(master.rightsStatus)) {
    throw new TypeError('Cover copying is not permitted');
  }
  if (!COVER_CONTENT_TYPES.includes(master.contentType)) {
    throw new TypeError('Unsupported cover content type');
  }
  if (master.metadataStripped !== true || master.orientationNormalized !== true || master.colorSpace !== 'srgb') {
    throw new TypeError('Cover master is not normalized');
  }
  if (master.bytes.byteLength === 0 || master.bytes.byteLength > MAX_COVER_BYTES) {
    throw new RangeError('Cover byte length is outside the accepted range');
  }
  if (!Number.isInteger(master.width) || !Number.isInteger(master.height)
    || master.width < 1 || master.height < 1
    || master.width > MAX_COVER_DIMENSION || master.height > MAX_COVER_DIMENSION) {
    throw new RangeError('Cover dimensions are outside the accepted range');
  }
  const source = new URL(master.sourceUrl);
  if (source.protocol !== 'https:') throw new TypeError('Cover provenance must use HTTPS');
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export class R2CoverMasterAdapter {
  constructor(private readonly bucket: CoverObjectStore) {}

  async ingest(master: NormalizedCoverMaster): Promise<StoredCoverMaster> {
    assertNormalizedMaster(master);
    const normalizedBytes = Uint8Array.from(master.bytes);
    const checksum = await crypto.subtle.digest('SHA-256', normalizedBytes);
    const digest = hex(checksum);
    const key = `covers/masters/sha256/${digest}.${EXTENSIONS[master.contentType]}`;
    const existing = await this.bucket.head(key);
    if (existing) return this.result(master, digest, key, false);

    const baseMetadata = {
      colorSpace: master.colorSpace,
      height: String(master.height),
      metadataStripped: 'true',
      orientationNormalized: 'true',
      rightsStatus: master.rightsStatus,
      sourceUrl: master.sourceUrl,
      width: String(master.width),
    } satisfies Record<string, string>;
    const customMetadata = master.attribution
      ? { ...baseMetadata, attribution: master.attribution }
      : baseMetadata;

    const stored = await this.bucket.put(key, normalizedBytes, {
      customMetadata,
      httpMetadata: {
        cacheControl: 'public, max-age=31536000, immutable',
        contentType: master.contentType,
      },
      onlyIf: { etagDoesNotMatch: '*' },
      sha256: new Uint8Array(checksum),
    });
    return this.result(master, digest, key, stored !== null);
  }

  private result(
    master: NormalizedCoverMaster,
    digest: string,
    key: string,
    created: boolean,
  ): StoredCoverMaster {
    return {
      contentType: master.contentType,
      created,
      digest,
      height: master.height,
      key,
      width: master.width,
    };
  }
}
