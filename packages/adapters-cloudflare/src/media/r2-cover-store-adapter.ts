import type {
  CoverImageRenderPort,
  CoverMasterReadPort,
  CoverOutputFormat,
} from '@tobirink/application';
import { favoritePublicReferenceSchema } from '@tobirink/application';
import type { FavoritePublicReference } from '@tobirink/application';
import { z } from 'zod';

const coverReferenceSchema = z.strictObject({ schemaVersion: z.literal(1), digest: z.string().regex(/^[a-f0-9]{64}$/u), extension: z.enum(['avif', 'jpg', 'png', 'webp']) });

interface CoverObjectBody {
  body: ReadableStream<Uint8Array>;
}

export interface CoverReadBucket {
  get(key: string): Promise<CoverObjectBody | null>;
}

interface CoverImagePipeline {
  output(options: { format: CoverOutputFormat; quality?: number }): Promise<{ response(options: { headers: HeadersInit }): Response }>;
  transform(transform: { fit: 'scale-down'; height: number; width: number }): CoverImagePipeline;
}

interface CoverImagesBinding {
  input(body: ReadableStream): CoverImagePipeline;
}

export class R2CoverMasterReadAdapter implements CoverMasterReadPort {
  constructor(private readonly bucket: CoverReadBucket) {}

  async findMaster(input: FavoritePublicReference) {
    const reference = favoritePublicReferenceSchema.parse(input);
    const referenceKey = ['covers', 'references', reference.provider, reference.externalId.concat('.json')].join('/');
    const object = await this.bucket.get(referenceKey);
    if (object === null) return undefined;
    const reader = object.body.getReader();
    const bytes: number[] = [];
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (bytes.length + chunk.value.byteLength > 4096) return undefined;
        bytes.push(...chunk.value);
      }
      return coverReferenceSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(new Uint8Array(bytes))));
    } catch { return undefined; }
    finally { await reader.cancel(); reader.releaseLock(); }
  }

  async readMaster(key: string): Promise<ReadableStream<Uint8Array> | undefined> {
    const object = await this.bucket.get(key);
    return object?.body;
  }
}

export class CloudflareCoverImageAdapter implements CoverImageRenderPort {
  constructor(private readonly images: CoverImagesBinding) {}

  async render(input: {
    body: ReadableStream<Uint8Array>;
    format: CoverOutputFormat;
    headers: HeadersInit;
    quality: number | undefined;
    transform: { fit: 'scale-down'; height: number; width: number };
  }): Promise<Response> {
    const output: { format: CoverOutputFormat; quality?: number } = input.quality === undefined
      ? { format: input.format }
      : { format: input.format, quality: input.quality };
    const transformed = await this.images.input(input.body).transform(input.transform).output(output);
    return transformed.response({ headers: input.headers });
  }
}
