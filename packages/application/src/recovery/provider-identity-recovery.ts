import { createWork, favoriteSourceId, workId } from '@tobirink/domain';
import { z } from 'zod';
import { favoriteCollectiveKey, favoritePublicReferenceSchema } from '../collective-index/favorite-collective-lookup';
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
  coverRepairAfterId: z.string().min(1).max(256).optional(),
  scan: z.strictObject({
    afterId: z.string().min(1).max(256).optional(), complete: z.boolean(), ids: syncedProviderIdsSchema,
    sourceAfterId: z.string().min(1).max(256).optional(), worksComplete: z.boolean().optional(),
  }).optional(),
  restoration: z.strictObject({ digest: z.string().regex(/^[a-f0-9]{64}$/u), index: z.number().int().min(0).max(100000), complete: z.boolean(), missingCount: z.number().int().nonnegative(), retryAt: z.number().int().nonnegative().optional(), deferred: z.array(z.strictObject({ index: z.number().int().min(0).max(100000), retryAt: z.number().int().nonnegative() })).max(100000).refine(items => new Set(items.map(item => item.index)).size === items.length).optional() }).optional(),
});
export type ProviderIdentityRecoveryState = z.infer<typeof providerIdentityRecoveryStateSchema>;
export interface ProviderIdentityRecoveryStatePort {
  read(): Promise<ProviderIdentityRecoveryState | undefined>;
  save(state: ProviderIdentityRecoveryState): Promise<void>;
}

export async function scanHydratedProviderIds(storage: StoragePort, checkpoints: ProviderIdentityRecoveryStatePort): Promise<{ readonly complete: boolean; readonly ids: SyncedProviderIds }> {
  const state = providerIdentityRecoveryStateSchema.parse(await checkpoints.read() ?? { schemaVersion: 1 });
  if (state.scan?.complete) return { complete: true, ids: state.scan.ids };
  let ids = state.scan?.ids ?? emptySyncedProviderIds();
  let afterId = state.scan?.afterId;
  let worksComplete = state.scan?.worksComplete ?? false;
  if (!worksComplete) {
    const page = await storage.listWorks(afterId === undefined ? { limit: 100 } : { afterId: workId(afterId), limit: 100 });
    const additions = emptySyncedProviderIds();
    for (const work of page) for (const reference of work.externalReferences) {
      const parsed = favoritePublicReferenceSchema.safeParse(reference);
      if (parsed.success) additions[providerIdFields[parsed.data.provider]].push(parsed.data.externalId);
    }
    ids = mergeSyncedProviderIds(ids, additions);
    worksComplete = page.length < 100;
    afterId = page.at(-1)?.id;
    if (!worksComplete) {
      const scan = afterId === undefined ? { complete: false, ids, worksComplete } : { afterId, complete: false, ids, worksComplete };
      await checkpoints.save({ ...state, scan });
      return { complete: false, ids };
    }
  }
  const sourcePage = await storage.listFavoriteSources(state.scan?.sourceAfterId === undefined
    ? { limit: 100 }
    : { afterId: favoriteSourceId(state.scan.sourceAfterId), limit: 100 });
  const associations = [];
  for (const source of sourcePage) {
    if (source.presence !== 'observed' || source.resolution?.kind !== 'RESOLVED' || source.matchedWorkId === undefined) continue;
    const [record, work] = await Promise.all([storage.getFavoriteParseArtifact(source.id), storage.getWork(source.matchedWorkId)]);
    if (record?.artifact.identityKey === undefined || work?.hydration === undefined) continue;
    const key = await favoriteCollectiveKey(record.artifact);
    const references = work.externalReferences.flatMap((reference) => {
      const parsed = favoritePublicReferenceSchema.safeParse(reference);
      return parsed.success ? [parsed.data] : [];
    }).slice(0, 5);
    if (references.length === 0) continue;
    associations.push({ fingerprint: key.fingerprint, mediaKind: work.hydration.candidate.mediaKind, parserVersion: key.parserVersion, references, siteRulesVersion: key.siteRulesVersion });
  }
  ids = mergeSyncedProviderIds(ids, { ...emptySyncedProviderIds(), associations, snapshotVersion: 2 });
  const complete = sourcePage.length < 100;
  const sourceAfterId = sourcePage.at(-1)?.id;
  const scan = sourceAfterId === undefined ? { afterId, complete, ids, worksComplete } : { afterId, complete, ids, sourceAfterId, worksComplete };
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
  let restoration: NonNullable<ProviderIdentityRecoveryState['restoration']> = state.restoration?.digest === digest ? state.restoration : { digest, index: 0, complete: false, missingCount: 0 };
  if (restoration.complete) return { kind: 'COMPLETE', hydrated: 0 };
  const now = new Date(dependencies.now()).valueOf();
  const deferred = new Map((restoration.deferred ?? []).map(item => [item.index, item.retryAt]));
  if (restoration.retryAt !== undefined) {
    deferred.set(restoration.index, restoration.retryAt);
    restoration = { digest, index: restoration.index + 1, complete: false, missingCount: restoration.missingCount };
  }
  const providerDelays = new Map<string, number>();
  for (const [index, retryAt] of deferred) {
    const reference = referenceAt(ids, index);
    if (reference !== undefined && retryAt > now) providerDelays.set(reference.provider, Math.max(providerDelays.get(reference.provider) ?? 0, retryAt));
  }
  const save = () => dependencies.checkpoints.save({ ...state, restoration: { ...restoration, deferred: [...deferred].map(([index, retryAt]) => ({ index, retryAt })) } });
  let hydrated = 0;
  let attempted = 0;
  for (let inspected = 0; inspected < 100; inspected += 1) {
    const scanning = referenceAt(ids, restoration.index) !== undefined;
    const index = scanning ? restoration.index : [...deferred].find(([, retryAt]) => retryAt <= now)?.[0];
    const reference = index === undefined ? undefined : referenceAt(ids, index);
    if (reference === undefined) {
      if (deferred.size > 0) {
        await save();
        let retryAt = Number.POSITIVE_INFINITY;
        for (const value of deferred.values()) retryAt = Math.min(retryAt, value);
        return { kind: 'RETRYABLE', hydrated, retryAt };
      }
      restoration = { ...restoration, complete: true };
      await save();
      return { kind: 'COMPLETE', hydrated };
    }
    if (index === undefined) throw new Error('Recovery index is missing.');
    const id = favoriteCandidateWorkId(reference);
    const existing = await dependencies.storage.getWork(id);
    if (existing?.hydration === undefined) {
      const delayed = providerDelays.get(reference.provider);
      if (delayed !== undefined && delayed > now) {
        deferred.set(index, delayed);
        if (scanning) restoration = { ...restoration, index: index + 1 };
        await save();
        continue;
      }
      if (attempted >= 2) { await save(); return { kind: 'PENDING', hydrated }; }
      attempted += 1;
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
        deferred.set(index, retryAt);
        providerDelays.set(reference.provider, retryAt);
        if (scanning) restoration = { ...restoration, index: index + 1 };
        await save();
        continue;
      }
    }
    deferred.delete(index);
    if (scanning) restoration = { ...restoration, index: index + 1 };
    await save();
  }
  return { kind: 'PENDING', hydrated };
}
