import { collectiveDigest, favoriteCollectiveCommandSchema, favoriteCollectiveLookupQuerySchema, favoriteCollectiveReceiptSchema, favoriteOwnerCredentialsSchema, favoriteOwnerRegistrationSchema, favoritePairRedemptionSchema, favoriteSiteRulesSchema } from '@tobirink/application';
import type { FavoriteCollectiveCommand, FavoriteCollectiveKey, FavoriteOwnerCredentials, FavoriteOwnerRegistration, FavoritePairRedemption } from '@tobirink/application';
import { z } from 'zod';
import { readFavoriteProviderJson } from '../favorites/provider-http';
import type { FavoriteProviderFetch } from '../favorites/provider-http';

const acknowledgement = z.strictObject({ accepted: z.literal(true) });
export class HttpFavoriteCollectiveAdapter {
  private readonly origin: string;
  constructor(origin: string, private readonly fetcher: FavoriteProviderFetch = fetch) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password) throw new Error('Collective Worker requires an exact HTTPS origin.');
    this.origin = origin;
  }
  async register(input: FavoriteOwnerRegistration): Promise<void> {
    await readFavoriteProviderJson(this.fetcher, `${this.origin}/v2/favorites/owners`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(favoriteOwnerRegistrationSchema.parse(input)) }, acknowledgement);
  }
  async redeem(input: FavoritePairRedemption): Promise<void> {
    await readFavoriteProviderJson(this.fetcher, `${this.origin}/v2/favorites/pairings/redeem`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(favoritePairRedemptionSchema.parse(input)) }, acknowledgement);
  }
  async execute(input: FavoriteOwnerCredentials, value: FavoriteCollectiveCommand) {
    const credentials = favoriteOwnerCredentialsSchema.parse(input);
    const command = favoriteCollectiveCommandSchema.parse(value);
    const body = JSON.stringify(command);
    if (new TextEncoder().encode(body).byteLength > 65536) throw new Error('Collective request is too large.');
    const response = await readFavoriteProviderJson(this.fetcher, `${this.origin}/v2/favorites/batches`, {
      method: 'POST', body, headers: { Authorization: `Bearer ${credentials.token}`, 'X-Tobirink-Owner': credentials.ownerId, 'X-Tobirink-Installation': credentials.installationId, 'Content-Type': 'application/json' },
    }, favoriteCollectiveReceiptSchema);
    if (response.value.nonce !== command.nonce || response.value.digest !== await collectiveDigest(body)) throw new Error('Collective receipt correlation failed.');
    if (command.operation === 'lookup' && (response.value.results.length !== command.keys.length || response.value.results.some((result, index) => result.fingerprint !== command.keys[index]?.fingerprint))) throw new Error('Collective lookup correlation failed.');
    return response.value;
  }
  async lookup(credentials: FavoriteOwnerCredentials, keys: readonly FavoriteCollectiveKey[]) {
    return (await this.execute(credentials, { schemaVersion: 2, operation: 'lookup', nonce: crypto.randomUUID(), keys: favoriteCollectiveLookupQuerySchema.parse(keys) })).results;
  }
  async readRules() {
    return (await readFavoriteProviderJson(this.fetcher, `${this.origin}/v2/favorites/rules`, { method: 'GET' }, favoriteSiteRulesSchema)).value;
  }
}
