import type {
  PublicReleaseArtifactRecord,
  PublicReleaseObjectPort,
  PublicReleasePointerRecord,
  PublicReleaseSnapshotRecord,
} from '@tobirink/application';
import { publicReleasePointerSchema, publicReleaseSnapshotSchema } from './public-release-snapshot';

interface JsonObjectBody {
  json<T>(): Promise<T>;
  body?: ReadableStream<Uint8Array>;
  etag?: string;
  httpEtag?: string;
  httpMetadata?: { contentType?: string };
}

export interface ReleaseSnapshotBucket {
  get(key: string): Promise<JsonObjectBody | null>;
}

export class R2PublicReleaseObjectAdapter implements PublicReleaseObjectPort {
  constructor(private readonly bucket: ReleaseSnapshotBucket) {}

  async readPointer(key: string): Promise<PublicReleasePointerRecord | undefined> {
    const object = await this.bucket.get(key);
    return object ? publicReleasePointerSchema.parse(await object.json<unknown>()) : undefined;
  }

  async readSnapshot(key: string): Promise<PublicReleaseSnapshotRecord | undefined> {
    const object = await this.bucket.get(key);
    return object ? publicReleaseSnapshotSchema.parse(await object.json<unknown>()) : undefined;
  }

  async readArtifact(key: string): Promise<PublicReleaseArtifactRecord | undefined> {
    const object = await this.bucket.get(key);
    if (!object?.body) return undefined;
    return {
      body: object.body,
      contentType: object.httpMetadata?.contentType ?? 'application/octet-stream',
      etag: object.httpEtag ?? object.etag ?? '',
    };
  }
}
