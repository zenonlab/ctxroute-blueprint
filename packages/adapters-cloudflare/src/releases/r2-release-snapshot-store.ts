import type {
  PublicReleaseObjectPort,
  PublicReleasePointerRecord,
  PublicReleaseSnapshotRecord,
} from '@tobirink/application';
import { publicReleasePointerSchema, publicReleaseSnapshotSchema } from './public-release-snapshot';

interface JsonObjectBody {
  json<T>(): Promise<T>;
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
}
