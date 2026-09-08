import type { FavoriteProvider } from '@tobirink/domain';
import { z } from 'zod';
import { favoritePublicReferenceSchema } from '../collective-index/favorite-collective-lookup';

export const providerSyncPrefix = 'tobirink.provider-ids.v1.';
export const providerSyncQuota = Object.freeze({ bytes: 102400, items: 512, itemBytes: 8192, writeIntervalMs: 2100 });
function ids(provider: FavoriteProvider) {
  return z.array(z.string().max(64).refine((id) => favoritePublicReferenceSchema.safeParse({ provider, externalId: id }).success).transform((id) => provider === 'mangadex' ? id.toLowerCase() : id)).max(20000);
}
export const syncedProviderIdsSchema = z.strictObject({ anilist: ids('anilist'), mangaUpdates: ids('mangaupdates'), mangaDex: ids('mangadex'), kitsuAnime: ids('kitsu-anime'), kitsuManga: ids('kitsu-manga') });
export type SyncedProviderIds = z.infer<typeof syncedProviderIdsSchema>;
export const providerIdFields = { anilist: 'anilist', mangaupdates: 'mangaUpdates', mangadex: 'mangaDex', 'kitsu-anime': 'kitsuAnime', 'kitsu-manga': 'kitsuManga' } as const satisfies Record<FavoriteProvider, keyof SyncedProviderIds>;
const fields = ['anilist', 'mangaUpdates', 'mangaDex', 'kitsuAnime', 'kitsuManga'] as const;
const generationSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const syncedProviderManifestSchema = z.strictObject({ schemaVersion: z.literal(1), generation: generationSchema, fragmentCount: z.number().int().min(1).max(510), itemCount: z.number().int().min(0).max(100000), byteLength: z.number().int().positive().max(102399), digest: z.string().regex(/^[a-f0-9]{64}$/u) });
export type SyncedProviderManifest = z.infer<typeof syncedProviderManifestSchema>;
const fragmentSchema = z.strictObject({ schemaVersion: z.literal(1), generation: generationSchema, index: z.number().int().min(0).max(509), payload: z.string().max(8191) });
export type ProviderSyncItem = SyncedProviderManifest | z.infer<typeof fragmentSchema>;
export const providerSyncWriteValuesSchema = z.record(z.string().regex(/^tobirink\.provider-ids\.v1\.[1-9]\d{0,15}\.[a-f0-9]{64}\.(?:manifest|fragment\.\d{1,3})$/u), z.union([syncedProviderManifestSchema, fragmentSchema]));
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

function namespace(generation: number, hash: string): string { return `${providerSyncPrefix}${generation}.${hash}`; }

export async function prepareProviderIdentitySnapshot(input: SyncedProviderIds, generation: number): Promise<ProviderIdentitySnapshot> {
  generationSchema.parse(generation);
  const normalized = mergeSyncedProviderIds(input);
  const payload = JSON.stringify(normalized);
  if (new TextEncoder().encode(payload).byteLength >= providerSyncQuota.bytes) throw new Error('PROVIDER_SYNC_QUOTA_EXCEEDED');
  const hash = await digest(payload);
  const prefix = namespace(generation, hash);
  const fragments: Record<string, ProviderSyncItem> = {};
  let offset = 0; let index = 0;
  while (offset < payload.length) {
    let end = Math.min(offset + 6000, payload.length);
    const key = `${prefix}.fragment.${index}`;
    let fragment = { schemaVersion: 1 as const, generation, index, payload: payload.slice(offset, end) };
    while (providerSyncItemBytes(key, fragment) >= providerSyncQuota.itemBytes) {
      end = offset + Math.floor((end - offset) / 2);
      fragment = { ...fragment, payload: payload.slice(offset, end) };
    }
    fragments[key] = fragment; offset = end; index += 1;
  }
  const manifest = syncedProviderManifestSchema.parse({ schemaVersion: 1, generation, fragmentCount: index, itemCount: fields.reduce((count, field) => count + normalized[field].length, 0), byteLength: new TextEncoder().encode(payload).byteLength, digest: hash });
  return { fragments, manifest, manifestKey: `${prefix}.manifest` };
}

export async function readProviderIdentityGeneration(values: ProviderSyncStorageValues, manifest: SyncedProviderManifest): Promise<SyncedProviderIds | undefined> {
  const prefix = namespace(manifest.generation, manifest.digest);
  let payload = '';
  for (let index = 0; index < manifest.fragmentCount; index += 1) {
    const fragment = fragmentSchema.safeParse(values[`${prefix}.fragment.${index}`]);
    if (!fragment.success || fragment.data.generation !== manifest.generation || fragment.data.index !== index) return undefined;
    payload += fragment.data.payload;
    if (new TextEncoder().encode(payload).byteLength > manifest.byteLength) return undefined;
  }
  if (new TextEncoder().encode(payload).byteLength !== manifest.byteLength || await digest(payload) !== manifest.digest) return undefined;
  try {
    const normalized = mergeSyncedProviderIds(syncedProviderIdsSchema.parse(JSON.parse(payload)));
    if (JSON.stringify(normalized) !== payload || fields.reduce((count, field) => count + normalized[field].length, 0) !== manifest.itemCount) return undefined;
    return normalized;
  } catch { return undefined; }
}

export async function readProviderIdentitySnapshots(values: ProviderSyncStorageValues): Promise<{ ids: SyncedProviderIds; generation: number; validGenerations: number; invalidGenerations: number }> {
  if (Object.keys(values).length > providerSyncQuota.items) throw new Error('PROVIDER_SYNC_QUOTA_EXCEEDED');
  const snapshots: SyncedProviderIds[] = [];
  let generation = 0; let invalidGenerations = 0;
  for (const [key, value] of Object.entries(values)) {
    if (!key.startsWith(providerSyncPrefix) || !key.endsWith('.manifest')) continue;
    const parsed = syncedProviderManifestSchema.safeParse(value);
    if (!parsed.success || key !== `${namespace(parsed.data.generation, parsed.data.digest)}.manifest`) { invalidGenerations += 1; continue; }
    const ids = await readProviderIdentityGeneration(values, parsed.data);
    if (ids === undefined) { invalidGenerations += 1; continue; }
    snapshots.push(ids); generation = Math.max(generation, parsed.data.generation);
  }
  return { ids: mergeSyncedProviderIds(...snapshots), generation, validGenerations: snapshots.length, invalidGenerations };
}
