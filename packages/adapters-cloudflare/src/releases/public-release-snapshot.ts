import { z } from 'zod';

export const PUBLIC_RELEASE_AVAILABILITY = ['confirmed', 'estimated', 'official'] as const;

const publicReleaseIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{2,127}$/);
const publicReleaseEntrySchema = z.strictObject({
  availability: z.enum(PUBLIC_RELEASE_AVAILABILITY),
  label: z.string().min(1).max(160),
  occursAt: z.iso.datetime(),
  releaseId: publicReleaseIdSchema,
  workId: publicReleaseIdSchema,
});

export const publicReleasePointerSchema = z.strictObject({
  revision: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
});

export const publicReleaseSnapshotSchema = z.strictObject({
  entries: z.array(publicReleaseEntrySchema).max(200),
  generatedAt: z.iso.datetime(),
  revision: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
}).superRefine((snapshot, context) => {
  if (new Set(snapshot.entries.map((entry) => entry.releaseId)).size !== snapshot.entries.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate public release identity', path: ['entries'] });
  }
});

export type PublicReleaseEntry = z.infer<typeof publicReleaseEntrySchema>;
export type PublicReleaseSnapshotInput = z.input<typeof publicReleaseSnapshotSchema>;
export type PublicReleaseSnapshot = z.output<typeof publicReleaseSnapshotSchema>;

export type PublicReleaseSnapshotResult =
  | { snapshot: PublicReleaseSnapshot; source: 'network' }
  | { snapshot: PublicReleaseSnapshot; source: 'cache' };

export interface PublicReleaseRemote {
  loadLatest(): Promise<PublicReleaseSnapshotInput>;
}

export interface PublicReleaseCache {
  load(): Promise<PublicReleaseSnapshotInput | undefined>;
  save(snapshot: PublicReleaseSnapshot): Promise<void>;
}

export function parsePublicReleaseSnapshot(value: PublicReleaseSnapshotInput): PublicReleaseSnapshot {
  const snapshot = publicReleaseSnapshotSchema.parse(value);
  const entries = [...snapshot.entries].sort((left, right) => {
    const dateOrder = left.occursAt.localeCompare(right.occursAt);
    return dateOrder === 0 ? left.releaseId.localeCompare(right.releaseId) : dateOrder;
  });
  return { entries, generatedAt: snapshot.generatedAt, revision: snapshot.revision };
}

export class PublicReleaseSnapshotAdapter {
  constructor(
    private readonly remote: PublicReleaseRemote,
    private readonly cache: PublicReleaseCache,
  ) {}

  async latest(): Promise<PublicReleaseSnapshotResult> {
    try {
      const snapshot = parsePublicReleaseSnapshot(await this.remote.loadLatest());
      await this.cache.save(snapshot);
      return { snapshot, source: 'network' };
    } catch {
      const cached = await this.cache.load();
      if (cached === undefined) throw new Error('Public release snapshot is unavailable');
      return { snapshot: parsePublicReleaseSnapshot(cached), source: 'cache' };
    }
  }
}
