import type { FavoriteProvider } from '@tobirink/domain';
import { z } from 'zod';
import { favoritePublicReferenceSchema } from '../favorites/favorite-identity-lookup';

export const providerSyncPrefix = 'tobirink.provider-ids.';
export const providerSyncQuota = Object.freeze({ bytes: 102400, items: 512, itemBytes: 8192, writeIntervalMs: 2100 });
export const syncedProviderAssociationSchema = z.strictObject({
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
  mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA']),
  parserVersion: z.string().min(1).max(256),
  siteRulesVersion: z.string().min(1).max(256),
  references: z.array(favoritePublicReferenceSchema).min(1).max(5)
    .refine((references) => new Set(references.map((reference) => reference.provider)).size === references.length),
});
export type SyncedProviderAssociation = z.infer<typeof syncedProviderAssociationSchema>;
function ids(provider: FavoriteProvider) {
  return z.array(z.string().max(64).refine((id) => favoritePublicReferenceSchema.safeParse({ provider, externalId: id }).success).transform((id) => provider === 'mangadex' ? id.toLowerCase() : id)).max(20000);
}
export const syncedProviderSnapshotVersion = 2 as const;
export const syncedProviderIdsSchema = z.strictObject({
  anilist: ids('anilist'), mangaUpdates: ids('mangaupdates'), mangaDex: ids('mangadex'), kitsuAnime: ids('kitsu-anime'), kitsuManga: ids('kitsu-manga'),
  snapshotVersion: z.literal(syncedProviderSnapshotVersion).optional(),
  associations: z.array(syncedProviderAssociationSchema).max(10000).optional(),
});
export type SyncedProviderIds = z.infer<typeof syncedProviderIdsSchema>;
export const providerIdFields = { anilist: 'anilist', mangaupdates: 'mangaUpdates', mangadex: 'mangaDex', 'kitsu-anime': 'kitsuAnime', 'kitsu-manga': 'kitsuManga' } as const satisfies Record<FavoriteProvider, keyof SyncedProviderIds>;
const fields = ['anilist', 'mangaUpdates', 'mangaDex', 'kitsuAnime', 'kitsuManga'] as const;
const generationSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const manifestFields = { generation: generationSchema, fragmentCount: z.number().int().min(1).max(510), itemCount: z.number().int().min(0).max(100000), byteLength: z.number().int().positive().max(102399), digest: z.string().regex(/^[a-f0-9]{64}$/u) };
export const syncedProviderManifestSchema = z.union([
  z.strictObject({ schemaVersion: z.literal(1), ...manifestFields }),
  z.strictObject({ schemaVersion: z.literal(2), ...manifestFields }),
]);
export type SyncedProviderManifest = z.infer<typeof syncedProviderManifestSchema>;
const fragmentFields = { generation: generationSchema, index: z.number().int().min(0).max(509), payload: z.string().max(8191) };
const fragmentSchema = z.union([
  z.strictObject({ schemaVersion: z.literal(1), ...fragmentFields }),
  z.strictObject({ schemaVersion: z.literal(2), ...fragmentFields }),
]);
export type ProviderSyncItem = SyncedProviderManifest | z.infer<typeof fragmentSchema>;
export const providerSyncWriteValuesSchema = z.record(z.string().regex(/^tobirink\.provider-ids\.v[12]\.[1-9]\d{0,15}\.[a-f0-9]{64}\.(?:manifest|fragment\.\d{1,3})$/u), z.union([syncedProviderManifestSchema, fragmentSchema]));
export const providerSyncStorageValuesSchema = z.record(z.string(), z.json());
export type ProviderSyncStorageValues = z.infer<typeof providerSyncStorageValuesSchema>;
export interface ProviderIdentitySnapshot {
  readonly fragments: Readonly<Record<string, ProviderSyncItem>>;
  readonly manifest: SyncedProviderManifest;
  readonly manifestKey: string;
}

export function emptySyncedProviderIds(): SyncedProviderIds { return { anilist: [], mangaUpdates: [], mangaDex: [], kitsuAnime: [], kitsuManga: [] }; }

export function mergeSyncedProviderIds(...snapshots: readonly SyncedProviderIds[]): SyncedProviderIds {
  const normalized = snapshots.map((snapshot) => syncedProviderIdsSchema.parse(snapshot));
  const result = emptySyncedProviderIds();
  for (const field of fields) result[field] = [...new Set(normalized.flatMap((snapshot) => snapshot[field]))].sort();
  const associations = new Map<string, SyncedProviderAssociation>();
  const conflicts = new Set<string>();
  for (const association of normalized.flatMap((snapshot) => snapshot.associations ?? [])) {
    const associationId = [association.fingerprint, association.mediaKind].join(':');
    if (conflicts.has(associationId)) continue;
    const previous = associations.get(associationId);
    if (previous !== undefined && !previous.references.some((left) => association.references.some((right) => left.provider === right.provider && left.externalId === right.externalId))) {
      associations.delete(associationId);
      conflicts.add(associationId);
      continue;
    }
    const references = [...new Map([...(previous?.references ?? []), ...association.references]
      .map((reference) => [`${reference.provider}:${reference.externalId}`, reference])).values()]
      .sort((left, right) => `${left.provider}:${left.externalId}`.localeCompare(`${right.provider}:${right.externalId}`));
    if (references.length <= 5) associations.set(associationId, { ...association, references });
  }
  if (associations.size > 0 || normalized.some((snapshot) => snapshot.snapshotVersion === syncedProviderSnapshotVersion)) {
    result.snapshotVersion = syncedProviderSnapshotVersion;
    result.associations = [...associations.values()].sort((left, right) => `${left.fingerprint}:${left.mediaKind}`.localeCompare(`${right.fingerprint}:${right.mediaKind}`));
  }
  return result;
}

export function providerSyncItemBytes(key: string, value: ProviderSyncStorageValues[string]): number {
  return new TextEncoder().encode(key).byteLength + new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function assertProviderSyncQuota(existing: ProviderSyncStorageValues, writes: Readonly<Record<string, ProviderSyncItem>>): void {
  const combined = { ...existing, ...writes };
  const entries = Object.entries(combined);
  if (entries.length >= providerSyncQuota.items || entries.reduce((sum, [key, value]) => sum + providerSyncItemBytes(key, value), 0) >= providerSyncQuota.bytes) throw new Error('PROVIDER_SYNC_QUOTA_EXCEEDED');
  if (Object.entries(writes).some(([key, value]) => providerSyncItemBytes(key, value) >= providerSyncQuota.itemBytes)) throw new Error('PROVIDER_SYNC_ITEM_TOO_LARGE');
}

async function digest(value: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function providerIdentitySnapshotDigest(input: SyncedProviderIds): Promise<string> { return digest(JSON.stringify(mergeSyncedProviderIds(input))); }

function namespace(schemaVersion: 1 | 2, generation: number, hash: string): string { return `${providerSyncPrefix}v${schemaVersion}.${generation}.${hash}`; }

export async function prepareProviderIdentitySnapshot(input: SyncedProviderIds, generation: number): Promise<ProviderIdentitySnapshot> {
  generationSchema.parse(generation);
  const normalized = mergeSyncedProviderIds(input);
  const schemaVersion = normalized.snapshotVersion === syncedProviderSnapshotVersion ? 2 as const : 1 as const;
  const payload = JSON.stringify(normalized);
  if (new TextEncoder().encode(payload).byteLength >= providerSyncQuota.bytes) throw new Error('PROVIDER_SYNC_QUOTA_EXCEEDED');
  const hash = await digest(payload);
  const prefix = namespace(schemaVersion, generation, hash);
  const fragments: Record<string, ProviderSyncItem> = {};
  let offset = 0; let index = 0;
  while (offset < payload.length) {
    let end = Math.min(offset + 6000, payload.length);
    const key = `${prefix}.fragment.${index}`;
    let fragment: z.infer<typeof fragmentSchema> = { schemaVersion, generation, index, payload: payload.slice(offset, end) };
    while (providerSyncItemBytes(key, fragment) >= providerSyncQuota.itemBytes) {
      end = offset + Math.floor((end - offset) / 2);
      fragment = { ...fragment, payload: payload.slice(offset, end) };
    }
    fragments[key] = fragment; offset = end; index += 1;
  }
  const manifest = syncedProviderManifestSchema.parse({ schemaVersion, generation, fragmentCount: index, itemCount: fields.reduce((count, field) => count + normalized[field].length, normalized.associations?.length ?? 0), byteLength: new TextEncoder().encode(payload).byteLength, digest: hash });
  return { fragments, manifest, manifestKey: `${prefix}.manifest` };
}

export async function readProviderIdentityGeneration(values: ProviderSyncStorageValues, manifest: SyncedProviderManifest): Promise<SyncedProviderIds | undefined> {
  const prefix = namespace(manifest.schemaVersion, manifest.generation, manifest.digest);
  let payload = '';
  for (let index = 0; index < manifest.fragmentCount; index += 1) {
    const fragment = fragmentSchema.safeParse(values[`${prefix}.fragment.${index}`]);
    if (!fragment.success || fragment.data.schemaVersion !== manifest.schemaVersion || fragment.data.generation !== manifest.generation || fragment.data.index !== index) return undefined;
    payload += fragment.data.payload;
    if (new TextEncoder().encode(payload).byteLength > manifest.byteLength) return undefined;
  }
  if (new TextEncoder().encode(payload).byteLength !== manifest.byteLength || await digest(payload) !== manifest.digest) return undefined;
  try {
    const normalized = mergeSyncedProviderIds(syncedProviderIdsSchema.parse(JSON.parse(payload)));
    if (JSON.stringify(normalized) !== payload || fields.reduce((count, field) => count + normalized[field].length, normalized.associations?.length ?? 0) !== manifest.itemCount) return undefined;
    return normalized;
  } catch { return undefined; }
}

export async function readProviderIdentitySnapshots(values: ProviderSyncStorageValues): Promise<{ ids: SyncedProviderIds; newestIds: SyncedProviderIds; generation: number; validGenerations: number; invalidGenerations: number; obsoleteKeys: readonly string[] }> {
  if (Object.keys(values).length > providerSyncQuota.items) throw new Error('PROVIDER_SYNC_QUOTA_EXCEEDED');
  const snapshots: { ids: SyncedProviderIds; generation: number; keys: readonly string[] }[] = [];
  let generation = 0; let invalidGenerations = 0;
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(providerSyncPrefix) || !key.endsWith('.manifest')) continue;
    const parsed = syncedProviderManifestSchema.safeParse(value);
    if (!parsed.success || key !== `${namespace(parsed.data.schemaVersion, parsed.data.generation, parsed.data.digest)}.manifest`) { invalidGenerations += 1; continue; }
    const ids = await readProviderIdentityGeneration(values, parsed.data);
    if (ids === undefined) { invalidGenerations += 1; continue; }
    const prefix = namespace(parsed.data.schemaVersion, parsed.data.generation, parsed.data.digest);
    snapshots.push({ ids, generation: parsed.data.generation, keys: [key, ...Array.from({ length: parsed.data.fragmentCount }, (_, index) => `${prefix}.fragment.${index}`)] });
    generation = Math.max(generation, parsed.data.generation);
  }
  const retainedGenerations = [...new Set(snapshots.map((snapshot) => snapshot.generation))].sort((left, right) => right - left).slice(0, 2);
  const retained = snapshots.filter((snapshot) => retainedGenerations.includes(snapshot.generation));
  const newest = retained.filter((snapshot) => snapshot.generation === generation);
  const retainedKeys = new Set(retained.flatMap((snapshot) => snapshot.keys));
  const obsoleteKeys = Object.keys(values).filter((key) => key.startsWith(providerSyncPrefix) && !retainedKeys.has(key)).sort();
  return {
    ids: mergeSyncedProviderIds(...retained.map((snapshot) => snapshot.ids)),
    newestIds: mergeSyncedProviderIds(...newest.map((snapshot) => snapshot.ids)),
    generation,
    validGenerations: retained.length,
    invalidGenerations,
    obsoleteKeys,
  };
}
