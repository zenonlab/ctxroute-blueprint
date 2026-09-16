import { favoriteIdentityKey, normalizeFavoriteTitle } from '@tobirink/application';
import type { PublicDiscoveryKey, PublicDiscoveryRequestClientPort, StoragePort } from '@tobirink/application';
import { createWork, favoriteSourceId } from '@tobirink/domain';
import type { Work } from '@tobirink/domain';
import { z } from 'zod';

export const publicDiscoveryRefreshCheckpointKey = 'tobirink.public-discovery-refresh.v1';
export const publicDiscoveryLookupBatchLimit = 50;
export const publicDiscoveryRefreshWakeLimit = 20;
const dayMilliseconds = 86_400_000;

const checkpointSchema = z.strictObject({
  afterSourceId: z.string().regex(/^source_[a-z0-9][a-z0-9_-]{5,}$/u).optional(),
  nextCycleAt: z.iso.datetime({ offset: false }).optional(),
  version: z.literal(1),
});
type Checkpoint = z.output<typeof checkpointSchema>;
type CheckpointValues = { [publicDiscoveryRefreshCheckpointKey]?: Checkpoint };

export interface PublicDiscoveryRefreshCheckpointStorage {
  get(key: typeof publicDiscoveryRefreshCheckpointKey): Promise<CheckpointValues>;
  set(value: { [publicDiscoveryRefreshCheckpointKey]: Checkpoint }): Promise<void>;
}

interface RefreshClient extends PublicDiscoveryRequestClientPort {
  lookup(keys: readonly PublicDiscoveryKey[]): Promise<readonly { key: PublicDiscoveryKey; state: Awaited<ReturnType<PublicDiscoveryRequestClientPort['resolveOrRequest']>> }[]>;
  requestRefresh(key: PublicDiscoveryKey): Promise<Extract<Awaited<ReturnType<PublicDiscoveryRequestClientPort['resolveOrRequest']>>, { state: 'VERIFIED' }>>;
}

export interface PublicDiscoveryRefreshResult {
  continuationRequired: boolean;
  inspected: number;
  refreshed: number;
  updated: number;
}

function keyId(key: PublicDiscoveryKey): string {
  return JSON.stringify(key);
}

export function publicDiscoveryRefreshDue(key: PublicDiscoveryKey, nextRefreshAt: string, now: string): boolean {
  const bucket = Number.parseInt(key.fingerprint.slice(0, 2), 16) % 7;
  return Date.parse(now) >= Date.parse(nextRefreshAt) + bucket * dayMilliseconds;
}

function refreshedWork(current: Work, key: PublicDiscoveryKey, state: Extract<Awaited<ReturnType<RefreshClient['resolveOrRequest']>>, { state: 'VERIFIED' }>): Work | undefined {
  const hydration = current.hydration;
  if (hydration === undefined || state.nextRefreshAt === undefined || state.profile.workId !== current.id) return undefined;
  const previous = hydration.publicDiscovery;
  if (previous !== undefined && Date.parse(state.verifiedAt) < Date.parse(previous.verifiedAt)) return undefined;
  if (previous?.verifiedAt === state.verifiedAt && previous.nextRefreshAt === state.nextRefreshAt) return undefined;
  const candidate = state.profile.candidate;
  const references = [...new Map([
    ...current.externalReferences,
    ...state.profile.references,
    { externalId: candidate.externalId, provider: candidate.provider },
  ].map((reference) => [`${reference.provider}:${reference.externalId}`, reference])).values()];
  return createWork({
    externalReferences: references,
    hydration: {
      candidate,
      favoriteAliasKeys: hydration.favoriteAliasKeys,
      hydratedAt: state.verifiedAt,
      matcherVersion: hydration.matcherVersion,
      providerTitleKeys: [...new Set(candidate.titles.map((title) => normalizeFavoriteTitle(title).normalized))],
      publicDiscovery: { ...key, nextRefreshAt: state.nextRefreshAt, verifiedAt: state.verifiedAt },
    },
    id: current.id,
    mediaKind: candidate.mediaKind === 'ANIME' ? 'anime' : 'manga',
    preferredTitle: candidate.displayTitle ?? candidate.titles[0] ?? current.preferredTitle,
  });
}

export function createPublicDiscoveryRefreshRuntime(dependencies: {
  checkpointStorage: PublicDiscoveryRefreshCheckpointStorage;
  client: RefreshClient;
  now: () => string;
  storage: StoragePort;
}) {
  return async function refreshStaleFavorites(): Promise<PublicDiscoveryRefreshResult> {
    const now = dependencies.now();
    const stored = checkpointSchema.safeParse((await dependencies.checkpointStorage.get(publicDiscoveryRefreshCheckpointKey))[publicDiscoveryRefreshCheckpointKey]);
    const checkpoint = stored.success ? stored.data : { version: 1 as const };
    if (checkpoint.nextCycleAt !== undefined && checkpoint.nextCycleAt > now) return { continuationRequired: false, inspected: 0, refreshed: 0, updated: 0 };
    const query = checkpoint.afterSourceId === undefined
      ? { limit: publicDiscoveryLookupBatchLimit }
      : { afterId: favoriteSourceId(checkpoint.afterSourceId), limit: publicDiscoveryLookupBatchLimit };
    const sources = await dependencies.storage.listFavoriteSources(query);
    const selected = sources.filter((source) => source.presence === 'observed' && source.matchedWorkId !== undefined);
    const [artifacts, works] = await Promise.all([
      dependencies.storage.getFavoriteParseArtifacts(selected.map((source) => source.id)),
      dependencies.storage.getWorks(selected.map((source) => source.matchedWorkId!)),
    ]);
    const entries = new Map<string, { key: PublicDiscoveryKey; work: Work }>();
    for (const [index, source] of selected.entries()) {
      const artifact = artifacts[index]?.artifact;
      const work = works[index];
      if (artifact?.identityKey === undefined || work === undefined || source.matchedWorkId !== work.id) continue;
      const key = await favoriteIdentityKey(artifact);
      entries.set(keyId(key), { key, work });
    }
    let refreshed = 0;
    let updated = 0;
    if (entries.size > 0) {
      const results = await dependencies.client.lookup([...entries.values()].map(({ key }) => key));
      for (const { key, state } of results) {
        const entry = entries.get(keyId(key));
        if (entry === undefined || state.state !== 'VERIFIED') continue;
        const replacement = refreshedWork(entry.work, key, state);
        if (replacement !== undefined) {
          await dependencies.storage.putWork(replacement);
          entry.work = replacement;
          updated += 1;
        }
        if (state.nextRefreshAt !== undefined && refreshed < publicDiscoveryRefreshWakeLimit && publicDiscoveryRefreshDue(key, state.nextRefreshAt, now)) {
          await dependencies.client.requestRefresh(key);
          refreshed += 1;
        }
      }
    }
    const continuationRequired = sources.length === publicDiscoveryLookupBatchLimit;
    const nextCheckpoint: Checkpoint = continuationRequired
      ? { afterSourceId: sources.at(-1)?.id, version: 1 }
      : { nextCycleAt: new Date(Date.parse(now) + dayMilliseconds).toISOString(), version: 1 };
    await dependencies.checkpointStorage.set({ [publicDiscoveryRefreshCheckpointKey]: nextCheckpoint });
    return { continuationRequired, inspected: sources.length, refreshed, updated };
  };
}
