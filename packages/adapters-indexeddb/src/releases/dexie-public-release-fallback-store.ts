import { publicReleaseEventSchema, publicReleaseFallbackStateSchema, publicReleasePageCheckpointSchema } from '@tobirink/application';
import type { PublicReleaseEventContract, PublicReleaseFallbackState, PublicReleaseFallbackStore, PublicReleasePageCheckpoint } from '@tobirink/application';
import type { PublicReleaseEvent } from '@tobirink/domain';
import type { TobirinkDatabase } from '../database';

export interface PublicReleaseStagingRecord { readonly id: string; readonly generation: string; readonly event: PublicReleaseEvent }
export interface PublicReleaseSyncRecord { readonly id: string; readonly activeGeneration?: string; readonly checkedAt: string; readonly etag?: string; readonly fallback?: PublicReleaseFallbackState; readonly generation: number; readonly source?: 'fallback' | 'shared' }

const fallbackStateId = 'fallback';
const activeStateId = 'active';

function toStoredEvent(input: PublicReleaseEventContract | PublicReleaseEvent): PublicReleaseEvent {
  const event = publicReleaseEventSchema.parse(input);
  const stored = { id: event.id, provider: event.provider, providerWorkId: event.providerWorkId, releaseKind: event.releaseKind, occurrence: event.occurrence, state: event.state, provenance: event.provenance, expiresAt: event.expiresAt } as const;
  return event.sequence === undefined ? stored : { ...stored, sequence: event.sequence };
}

export class DexiePublicReleaseFallbackStore implements PublicReleaseFallbackStore {
  constructor(private readonly database: TobirinkDatabase) {}

  async begin(state: PublicReleaseFallbackState): Promise<void> {
    const parsed = publicReleaseFallbackStateSchema.parse(state);
    await this.database.transaction('rw', this.database.publicReleaseSyncState, async () => {
      const active = await this.database.publicReleaseSyncState.get(activeStateId);
      await this.database.publicReleaseSyncState.put({ checkedAt: active?.checkedAt ?? parsed.startedAt, fallback: parsed, generation: active?.generation ?? 0, id: fallbackStateId });
    });
  }

  async load(): Promise<PublicReleaseFallbackState | undefined> {
    const value = (await this.database.publicReleaseSyncState.get(fallbackStateId))?.fallback;
    if (value === undefined) return undefined;
    const parsed = publicReleaseFallbackStateSchema.safeParse(value);
    return parsed.success ? parsed.data : undefined;
  }

  async stage(generation: string, checkpoint: PublicReleasePageCheckpoint): Promise<void> {
    const page = publicReleasePageCheckpointSchema.parse(checkpoint);
    await this.database.transaction('rw', this.database.publicReleaseStagingEvents, this.database.publicReleaseSyncState, async () => {
      const record = await this.database.publicReleaseSyncState.get(fallbackStateId);
      const state = record?.fallback && publicReleaseFallbackStateSchema.parse(record.fallback);
      if (record === undefined || state === undefined || state.generation !== generation) throw new Error('public-release-fallback-generation-mismatch');
      const lane = state.lanes[page.provider];
      if (lane.nextPage !== page.page || lane.complete) throw new Error('public-release-fallback-page-mismatch');
      await this.database.publicReleaseStagingEvents.bulkPut(page.events.map((event) => ({ event: toStoredEvent(event), generation, id: `${generation}:${event.id}` })));
      const nextLane = page.complete ? { complete: true, nextPage: page.page, notBefore: 0 } : { complete: false, nextPage: page.nextPage!, notBefore: page.notBefore! };
      const fallback = publicReleaseFallbackStateSchema.parse({ ...state, lanes: { ...state.lanes, [page.provider]: nextLane } });
      await this.database.publicReleaseSyncState.put({ ...record, checkedAt: new Date().toISOString(), fallback, generation: record.generation, id: fallbackStateId });
    });
  }

  async promote(generation: string, completedAt: string): Promise<void> {
    await this.database.transaction('rw', this.database.publicReleaseEvents, this.database.publicReleaseStagingEvents, this.database.publicReleaseSyncState, async () => {
      const record = await this.database.publicReleaseSyncState.get(fallbackStateId);
      if (record?.fallback?.generation !== generation || !record.fallback.lanes.anilist.complete || !record.fallback.lanes.mangaupdates.complete) throw new Error('public-release-fallback-incomplete');
      const staged = await this.database.publicReleaseStagingEvents.where('generation').equals(generation).toArray();
      await this.database.publicReleaseEvents.clear();
      await this.database.publicReleaseEvents.bulkPut(staged.map(({ event }) => toStoredEvent(event)));
      const active = await this.database.publicReleaseSyncState.get(activeStateId);
      await this.database.publicReleaseSyncState.put({ activeGeneration: generation, checkedAt: completedAt, generation: (active?.generation ?? 0) + 1, id: activeStateId, source: 'fallback' });
      await this.database.publicReleaseSyncState.delete(fallbackStateId);
      await this.database.publicReleaseStagingEvents.where('generation').equals(generation).delete();
    });
  }
}
