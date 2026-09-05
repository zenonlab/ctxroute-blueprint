import type {
  CoverImageRenderPort,
  CoverMasterReadPort,
  CoverOutputFormat,
} from '@tobirink/application';

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
