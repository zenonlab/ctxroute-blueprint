import { createWork, workId } from '@tobirink/domain';
import { z } from 'zod';
import { favoritePublicReferenceSchema } from '../collective-index/favorite-collective-lookup';
import { favoriteCandidateWorkId } from '../favorites/favorite-resolution-commit';
import { favoriteMatcherVersion, hasExactBlockedProviderTaxonomy } from '../favorites/provider-matcher';
import { FavoriteProviderRetryError, favoriteProviderPolicy } from '../favorites/provider-ports';
import type { FavoriteProviderHydrationPorts } from '../favorites/provider-ports';
import { normalizeFavoriteTitle } from '../favorites/title-normalization';
import type { StoragePort } from '../ports/storage-port';
import { emptySyncedProviderIds, mergeSyncedProviderIds, providerIdFields, providerIdentitySnapshotDigest, syncedProviderIdsSchema } from './provider-identity-snapshot';
import type { SyncedProviderIds } from './provider-identity-snapshot';

export const providerIdentityRecoveryStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  scan: z.strictObject({ afterId: z.string().min(1).max(256).optional(), complete: z.boolean(), ids: syncedProviderIdsSchema }).optional(),
  restoration: z.strictObject({ digest: z.string().regex(/^[a-f0-9]{64}$/u), index: z.number().int().min(0).max(100000), complete: z.boolean(), missingCount: z.number().int().nonnegative(), retryAt: z.number().int().nonnegative().optional() }).optional(),
});
export type ProviderIdentityRecoveryState = z.infer<typeof providerIdentityRecoveryStateSchema>;
export interface ProviderIdentityRecoveryStatePort {
  read(): Promise<ProviderIdentityRecoveryState | undefined>;
  save(state: ProviderIdentityRecoveryState): Promise<void>;
}

export async function scanHydratedProviderIds(storage: StoragePort, checkpoints: ProviderIdentityRecoveryStatePort): Promise<{ readonly complete: boolean; readonly ids: SyncedProviderIds }> {
  const state = providerIdentityRecoveryStateSchema.parse(await checkpoints.read() ?? { schemaVersion: 1 });
  if (state.scan?.complete) return { complete: true, ids: state.scan.ids };
  const page = await storage.listWorks(state.scan?.afterId === undefined ? { limit: 100 } : { afterId: workId(state.scan.afterId), limit: 100 });
  const additions = emptySyncedProviderIds();
  for (const work of page) for (const reference of work.externalReferences) {
    const parsed = favoritePublicReferenceSchema.safeParse(reference);
    if (parsed.success) additions[providerIdFields[parsed.data.provider]].push(parsed.data.externalId);
  }
  const ids = mergeSyncedProviderIds(state.scan?.ids ?? emptySyncedProviderIds(), additions);
  const complete = page.length < 100;
  const afterId = page.at(-1)?.id;
  const scan = afterId === undefined ? { complete, ids } : { afterId, complete, ids };
  await checkpoints.save({ ...state, scan });
  return { complete, ids };
}

export async function finishProviderIdentityScan(checkpoints: ProviderIdentityRecoveryStatePort): Promise<void> {
  const state = providerIdentityRecoveryStateSchema.parse(await checkpoints.read() ?? { schemaVersion: 1 });
  const { scan: _completed, ...remaining } = state;
  await checkpoints.save(remaining);
}

function referenceAt(ids: SyncedProviderIds, index: number) {
  let offset = index;
  for (const [provider, field] of Object.entries(providerIdFields)) {
    if (offset < ids[field].length) return favoritePublicReferenceSchema.parse({ provider, externalId: ids[field][offset] });
    offset -= ids[field].length;
  }
  return undefined;
}

export interface ProviderIdentityRecoveryDependencies {
  readonly checkpoints: ProviderIdentityRecoveryStatePort;
  readonly hydration: FavoriteProviderHydrationPorts;
  readonly now: () => string;
  readonly storage: StoragePort;
}
export type ProviderIdentityRestoreResult = { readonly kind: 'COMPLETE' | 'PENDING'; readonly hydrated: number } | { readonly kind: 'RETRYABLE'; readonly hydrated: number; readonly retryAt: number };

export async function restoreProviderIdentities(input: SyncedProviderIds, dependencies: ProviderIdentityRecoveryDependencies): Promise<ProviderIdentityRestoreResult> {
  const ids = mergeSyncedProviderIds(input);
  const digest = await providerIdentitySnapshotDigest(ids);
  const state = providerIdentityRecoveryStateSchema.parse(await dependencies.checkpoints.read() ?? { schemaVersion: 1 });
  let restoration = state.restoration?.digest === digest ? state.restoration : { digest, index: 0, complete: false, missingCount: 0 };
  if (restoration.complete) return { kind: 'COMPLETE', hydrated: 0 };
  const now = new Date(dependencies.now()).valueOf();
  if (restoration.retryAt !== undefined && restoration.retryAt > now) return { kind: 'RETRYABLE', hydrated: 0, retryAt: restoration.retryAt };
  let hydrated = 0;
  for (let inspected = 0; inspected < 100; inspected += 1) {
    const reference = referenceAt(ids, restoration.index);
    if (reference === undefined) {
      await dependencies.checkpoints.save({ ...state, restoration: { digest, index: restoration.index, complete: true, missingCount: restoration.missingCount } });
      return { kind: 'COMPLETE', hydrated };
    }
    const id = favoriteCandidateWorkId(reference);
    const existing = await dependencies.storage.getWork(id);
    if (existing?.hydration === undefined) {
      if (hydrated >= 2) return { kind: 'PENDING', hydrated };
      try {
        const adapter = dependencies.hydration[reference.provider];
        if (adapter === undefined) throw new Error('Recovery hydration provider is unavailable.');
        const candidate = await adapter.hydrate(reference);
        hydrated += 1;
        if (candidate === undefined || hasExactBlockedProviderTaxonomy(candidate)) restoration = { ...restoration, missingCount: restoration.missingCount + 1 };
        else {
          if (candidate.provider !== reference.provider || candidate.externalId !== reference.externalId) throw new Error('Recovery hydration identity mismatch.');
          await dependencies.storage.putWork(createWork({
            externalReferences: existing?.externalReferences ?? [reference], id, mediaKind: candidate.mediaKind === 'ANIME' ? 'anime' : 'manga', preferredTitle: candidate.titles[0] ?? '',
            hydration: { candidate, favoriteAliasKeys: [], hydratedAt: dependencies.now(), matcherVersion: favoriteMatcherVersion, providerTitleKeys: [...new Set(candidate.titles.map((title) => normalizeFavoriteTitle(title).normalized))] },
          }));
        }
      } catch (error) {
        const retryAt = Math.max(new Date(dependencies.now()).valueOf() + favoriteProviderPolicy.negativeTtlMs, error instanceof FavoriteProviderRetryError ? error.retryAt : 0);
        await dependencies.checkpoints.save({ ...state, restoration: { ...restoration, retryAt } });
        return { kind: 'RETRYABLE', hydrated, retryAt };
      }
    }
    restoration = { digest, index: restoration.index + 1, complete: false, missingCount: restoration.missingCount };
    await dependencies.checkpoints.save({ ...state, restoration });
  }
  return { kind: 'PENDING', hydrated };
}
