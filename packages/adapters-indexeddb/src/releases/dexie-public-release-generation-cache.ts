import { publicReleaseEventSchema, publicReleaseGenerationSchema } from '@tobirink/application';
import type { PublicReleaseGeneration, PublicReleaseGenerationCachePort } from '@tobirink/application';
import type { PublicReleaseEvent } from '@tobirink/domain';
import type { TobirinkDatabase } from '../database';

function storedEvent(input: PublicReleaseGeneration['events'][number]): PublicReleaseEvent {
  const event = publicReleaseEventSchema.parse(input);
  const required = { expiresAt: event.expiresAt, id: event.id, occurrence: event.occurrence, provenance: event.provenance, provider: event.provider, providerWorkId: event.providerWorkId, releaseKind: event.releaseKind, state: event.state } as const;
  return event.sequence === undefined ? required : { ...required, sequence: event.sequence };
}

export class DexiePublicReleaseGenerationCache implements PublicReleaseGenerationCachePort {
  constructor(private readonly database: TobirinkDatabase) {}

  async load(): Promise<PublicReleaseGeneration | undefined> {
    const active = await this.database.publicReleaseSyncState.get('active');
    if (!active?.activeGeneration || !active.etag || !active.revision || !active.window) return undefined;
    const events = await this.database.publicReleaseEvents.toArray();
    const parsed = publicReleaseGenerationSchema.safeParse({ etag: active.etag, events, generatedAt: active.checkedAt, revision: active.revision, source: active.source, window: active.window });
    return parsed.success ? parsed.data : undefined;
  }

  async save(input: PublicReleaseGeneration): Promise<void> {
    const generation = publicReleaseGenerationSchema.parse(input);
    await this.database.transaction('rw', this.database.publicReleaseEvents, this.database.publicReleaseSyncState, this.database.publicReleaseStagingEvents, async () => {
      await this.database.publicReleaseEvents.clear();
      await this.database.publicReleaseEvents.bulkPut(generation.events.map(storedEvent));
      const active = await this.database.publicReleaseSyncState.get('active');
      await this.database.publicReleaseSyncState.put({ activeGeneration: generation.revision, checkedAt: generation.generatedAt, etag: generation.etag, generation: (active?.generation ?? 0) + 1, id: 'active', revision: generation.revision, source: 'shared', window: generation.window });
      await this.database.publicReleaseSyncState.delete('fallback');
      await this.database.publicReleaseStagingEvents.clear();
    });
  }
}
