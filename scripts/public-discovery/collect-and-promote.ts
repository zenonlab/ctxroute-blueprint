import {
  AniListFavoriteProviderAdapter,
  KitsuFavoriteProviderAdapter,
  MangaDexFavoriteProviderAdapter,
  MangaUpdatesFavoriteProviderAdapter,
} from '@tobirink/adapters-browser';
import {
  publicDiscoveryKeySchema,
  publicDiscoveryPromotionBatchSchema,
  publicDiscoveryReferenceSchema,
  verifiedPublicDiscoveryProfile,
  type FavoriteProviderHydrationPort,
} from '@tobirink/application';
import { z } from 'zod';

const tokenSchema = z.string().min(32).max(8192);
const pendingSchema = z.strictObject({ claims: z.array(z.strictObject({
  key: publicDiscoveryKeySchema,
  proposalDigest: z.string().regex(/^[a-f0-9]{64}$/u),
  references: z.array(publicDiscoveryReferenceSchema).min(1).max(5),
})).max(50) });
const receiptSchema = z.strictObject({ promoted: z.number().int().nonnegative(), replayed: z.number().int().nonnegative() });

function requiredEnvironment(name: 'DISCOVERY_READ_OIDC_TOKEN' | 'DISCOVERY_WRITE_OIDC_TOKEN'): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing-${name.toLowerCase()}`);
  return tokenSchema.parse(value);
}

function hydration(provider: z.output<typeof publicDiscoveryReferenceSchema>['provider']): FavoriteProviderHydrationPort {
  if (provider === 'anilist') return new AniListFavoriteProviderAdapter();
  if (provider === 'mangaupdates') return new MangaUpdatesFavoriteProviderAdapter();
  if (provider === 'mangadex') return new MangaDexFavoriteProviderAdapter();
  return new KitsuFavoriteProviderAdapter(provider);
}

async function run(): Promise<void> {
  const readToken = requiredEnvironment('DISCOVERY_READ_OIDC_TOKEN');
  const pendingResponse = await fetch('https://tobirink.com/v2/catalogue/discoveries/pending?limit=50', { headers: { Authorization: `Bearer ${readToken}` }, signal: AbortSignal.timeout(30_000) });
  if (!pendingResponse.ok) throw new Error(`discovery-pending-${pendingResponse.status}:${(await pendingResponse.text()).slice(0, 256)}`);
  const pending = pendingSchema.parse(await pendingResponse.json());
  const promotions = [];
  const verifiedAt = new Date().toISOString();
  for (const claim of pending.claims) {
    for (const reference of claim.references) {
      const candidate = await hydration(reference.provider).hydrate(reference);
      if (!candidate) continue;
      const profile = await verifiedPublicDiscoveryProfile(claim.key, candidate);
      if (profile) {
        promotions.push({ key: claim.key, profile, proposalDigest: claim.proposalDigest, schemaVersion: 1 as const, verifiedAt });
        break;
      }
    }
  }
  if (promotions.length === 0) {
    process.stdout.write(`${JSON.stringify({ event: 'public_discovery_checked', pending: pending.claims.length, promoted: 0 })}\n`);
    return;
  }
  const payload = publicDiscoveryPromotionBatchSchema.parse({ nonce: crypto.randomUUID(), promotions, schemaVersion: 1 });
  const writeToken = requiredEnvironment('DISCOVERY_WRITE_OIDC_TOKEN');
  const response = await fetch('https://tobirink.com/v2/catalogue/discoveries/promotions', { body: JSON.stringify(payload), headers: { Authorization: `Bearer ${writeToken}`, 'Content-Type': 'application/json' }, method: 'POST', signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`discovery-promotion-${response.status}:${(await response.text()).slice(0, 256)}`);
  const receipt = receiptSchema.parse(await response.json());
  if (receipt.promoted + receipt.replayed !== promotions.length) throw new Error('discovery-promotion-incomplete');
  process.stdout.write(`${JSON.stringify({ event: 'public_discovery_promoted', pending: pending.claims.length, ...receipt })}\n`);
}

await run();
