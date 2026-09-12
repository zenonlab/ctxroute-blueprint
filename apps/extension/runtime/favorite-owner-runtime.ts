import { bundledFavoriteSiteRules, collectiveDigest, favoriteCollectiveAmbiguitySchema, favoriteCollectiveChoiceSchema, favoriteCollectiveKey, favoriteOwnerCredentialsSchema, favoriteOwnerLocalStateSchema, favoritePairRedemptionSchema, favoritePublicMetadata, favoritePublicReferenceSchema } from '@tobirink/application';
import type { FavoriteCollectiveCommand, FavoriteCollectiveKey, FavoriteCollectiveLookupPort, FavoriteOwnerLocalState, FavoriteOwnerLocalStatePort, StoragePort } from '@tobirink/application';
import type { HttpFavoriteCollectiveAdapter } from '@tobirink/adapters-browser';
import { favoriteSourceId } from '@tobirink/domain';
import type { z } from 'zod';

type Choice = z.infer<typeof favoriteCollectiveChoiceSchema>;
type Ambiguity = z.infer<typeof favoriteCollectiveAmbiguitySchema>;
function secretToken() { return [...crypto.getRandomValues(new Uint8Array(32))].map((byte) => byte.toString(16).padStart(2, '0')).join(''); }
export class FavoriteOwnerRuntime implements FavoriteCollectiveLookupPort {
  private active: Promise<void> = Promise.resolve();
  private rulesReadAt = 0;
  rules = bundledFavoriteSiteRules;
  constructor(private readonly local: FavoriteOwnerLocalStatePort, private readonly http: HttpFavoriteCollectiveAdapter, private readonly storage: StoragePort) {}

  private async serial<T>(run: () => Promise<T>): Promise<T> {
    const previous = this.active; let release = () => {};
    this.active = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await run(); } finally { release(); }
  }
  async status() { return (await this.local.read())?.status ?? 'disabled'; }
  private async activate(state: FavoriteOwnerLocalState) {
    if (state.redemption === undefined) await this.http.register(state.registration);
    else await this.http.redeem(state.redemption);
    const { redemption: _consumed, ...remaining } = state;
    const enabled = { ...remaining, status: 'enabled' as const };
    await this.local.save(enabled);
    return enabled;
  }
  enable() {
    return this.serial(async () => {
      let state = await this.local.read();
      if (state?.status === 'enabled') return;
      if (state === undefined || state.status === 'revoked') {
        state = { schemaVersion: 1, status: 'pending', sent: {}, registration: { ownerId: crypto.randomUUID(), installationId: crypto.randomUUID(), token: secretToken(), revokeToken: secretToken(), consent: true } };
        await this.local.save(state);
      }
      if (state.status !== 'pending') throw new Error('Collective revocation must finish first.');
      await this.activate(state);
    });
  }
  private async flush(state: FavoriteOwnerLocalState): Promise<FavoriteOwnerLocalState> {
    if (state.pending === undefined) return state;
    await this.http.execute(favoriteOwnerCredentialsSchema.parse({ ownerId: state.registration.ownerId, installationId: state.registration.installationId, token: state.registration.token }), state.pending);
    const { pending, ...remaining } = state;
    const sent = { ...remaining.sent };
    const lookups = { ...remaining.lookups };
    if (pending.operation === 'contribute') for (const contribution of [...pending.choices, ...(pending.ambiguities ?? [])]) {
      const keyId = await collectiveDigest(JSON.stringify(contribution.key));
      sent[keyId] = await collectiveDigest(JSON.stringify(contribution));
      const cached = lookups[keyId];
      if (cached !== undefined) lookups[keyId] = { ...cached, expiresAt: 0 };
    }
    const next = favoriteOwnerLocalStateSchema.parse({ ...remaining, sent, lookups, status: pending.operation === 'revoke' ? 'revoked' : remaining.status });
    await this.local.save(next);
    return next;
  }
  private async command(state: FavoriteOwnerLocalState, command: FavoriteCollectiveCommand) {
    const pending = { ...state, pending: command };
    await this.local.save(pending);
    return this.flush(pending);
  }
  private async updateRules(state?: FavoriteOwnerLocalState) {
    this.rules = state?.rules !== undefined && state.rules.version > bundledFavoriteSiteRules.version ? state.rules : bundledFavoriteSiteRules;
    const now = Date.now();
    if (now - (state?.rulesReadAt ?? this.rulesReadAt) <= 86400000) return state;
    try {
      const rules = await this.http.readRules();
      if (rules.version >= this.rules.version) this.rules = rules;
      this.rulesReadAt = now;
      if (state !== undefined) {
        const updated = { ...state, rules: this.rules, rulesReadAt: now };
        await this.local.save(updated);
        return updated;
      }
    } catch { /* Keep the last validated declarative rule set. */ }
    return state;
  }
  refreshRules() { return this.serial(async () => { await this.updateRules(await this.local.read()); }); }
  revoke() {
    return this.serial(async () => {
      const stored = await this.local.read();
      if (stored === undefined || stored.status === 'revoked') return;
      if (stored.status === 'revoking') { await this.flush(stored); return; }
      await this.command({ ...stored, status: 'revoking' }, { schemaVersion: 2, operation: 'revoke', nonce: crypto.randomUUID() });
    });
  }
  pair() {
    return this.serial(async () => {
      const stored = await this.local.read();
      if (stored?.status !== 'enabled') throw new Error('Collective consent is required.');
      const state = await this.flush(stored);
      const pairingToken = secretToken();
      await this.command(state, { schemaVersion: 2, operation: 'pair', nonce: crypto.randomUUID(), pairingToken });
      return `${state.registration.ownerId}:${pairingToken}`;
    });
  }
  redeem(invitation: string) {
    return this.serial(async () => {
      const [ownerId, pairingToken] = invitation.split(':');
      const previous = await this.local.read();
      if (previous?.status === 'enabled') throw new Error('Disable the current owner before pairing.');
      const credentials = favoriteOwnerCredentialsSchema.parse({ ownerId, installationId: previous?.registration.ownerId === ownerId ? previous.registration.installationId : crypto.randomUUID(), token: previous?.registration.ownerId === ownerId ? previous.registration.token : secretToken() });
      const redemption = favoritePairRedemptionSchema.parse({ ...credentials, pairingToken, consent: true });
      const state: FavoriteOwnerLocalState = { schemaVersion: 1, status: 'pending', sent: {}, registration: { ...credentials, consent: true, revokeToken: secretToken() }, redemption };
      await this.local.save(state);
      await this.activate(state);
    });
  }
  lookup(keys: readonly FavoriteCollectiveKey[]) {
    return this.serial(() => this.lookupCached(keys));
  }
  private async lookupCached(keys: readonly FavoriteCollectiveKey[]) {
    const state = await this.local.read();
    if (state?.status !== 'enabled') return keys.map((key) => ({ kind: 'MISS' as const, fingerprint: key.fingerprint }));
    const cache = { ...state.lookups };
    const keyIds = await Promise.all(keys.map((key) => collectiveDigest(JSON.stringify(key))));
    const missing = keys.filter((_key, index) => (cache[keyIds[index]]?.expiresAt ?? 0) <= Date.now());
    if (missing.length > 0) {
      const results = await this.http.lookup(favoriteOwnerCredentialsSchema.parse({ ownerId: state.registration.ownerId, installationId: state.registration.installationId, token: state.registration.token }), missing);
      for (let index = 0; index < results.length; index += 1) {
        const result = results[index];
        cache[await collectiveDigest(JSON.stringify(missing[index]))] = { expiresAt: Date.now() + (result.kind === 'MISS' ? 900000 : 86400000), result };
      }
      await this.local.save({ ...state, lookups: cache });
    }
    return keyIds.map((keyId) => cache[keyId].result);
  }
  maintain() {
    return this.serial(async () => {
      const stored = await this.local.read();
      if (stored === undefined || stored.status === 'revoked') return;
      let state = await this.flush(stored.status === 'pending' ? await this.activate(stored) : stored);
      if (state.status !== 'enabled') return;
      state = await this.updateRules(state) ?? state;
      const page = await this.storage.listFavoriteSources(state.scanAfter === undefined ? { limit: 50 } : { afterId: favoriteSourceId(state.scanAfter), limit: 50 });
      const choices = new Map<string, Choice>();
      const ambiguities = new Map<string, Ambiguity>();
      const pendingKeys = new Map<string, FavoriteCollectiveKey>();
      for (const source of page) {
        if (source.presence !== 'observed') continue;
        const record = await this.storage.getFavoriteParseArtifact(source.id);
        if (record?.artifact.identityKey !== undefined && (source.resolution === undefined || source.resolution.kind === 'RETRYABLE')) {
          const key = await favoriteCollectiveKey(record.artifact);
          pendingKeys.set(key.fingerprint, key);
        }
        const review = source.reviewId === undefined ? undefined : await this.storage.getReview(source.reviewId);
        if (review?.status === 'no-match') continue;
        if (review?.status === 'pending' && review.reason === 'AMBIGUOUS' && record?.artifact.identityKey !== undefined) {
          const candidateSet = await this.storage.getFavoriteReviewCandidateSet(review.id);
          const key = await favoriteCollectiveKey(record.artifact);
          const identities = candidateSet?.candidates.flatMap((candidate) => {
            const references = [{ provider: candidate.provider, externalId: candidate.externalId }, ...(candidate.linkedReferences ?? [])]
              .flatMap((reference) => {
                const parsed = favoritePublicReferenceSchema.safeParse(reference);
                return parsed.success ? [parsed.data] : [];
              });
            return references.length > 0 ? [{ mediaKind: candidate.mediaKind, references }] : [];
          }) ?? [];
          const ambiguity = favoriteCollectiveAmbiguitySchema.safeParse({ key, identities });
          if (ambiguity.success) {
            const keyId = await collectiveDigest(JSON.stringify(key));
            if (state.sent[keyId] !== await collectiveDigest(JSON.stringify(ambiguity.data))) ambiguities.set(keyId, ambiguity.data);
          }
          continue;
        }
        const id = source.matchedWorkId ?? review?.matchedWorkId;
        if (id === undefined) continue;
        const work = await this.storage.getWork(id);
        if (work?.hydration === undefined || record?.artifact.identityKey === undefined) continue;
        const key = await favoriteCollectiveKey(record.artifact);
        const choice = favoriteCollectiveChoiceSchema.safeParse({ key, mediaKind: work.hydration.candidate.mediaKind, references: work.externalReferences, metadata: favoritePublicMetadata(work.hydration.candidate), confirmed: review?.status === 'resolved' && review.decisionOrigin === 'human' });
        if (!choice.success) continue;
        const keyId = await collectiveDigest(JSON.stringify(key));
        if (state.sent[keyId] !== await collectiveDigest(JSON.stringify(choice.data))) choices.set(keyId, choice.data);
      }
      if (choices.size + ambiguities.size > 0) state = await this.command(state, { schemaVersion: 2, operation: 'contribute', nonce: crypto.randomUUID(), choices: [...choices.values()], ambiguities: [...ambiguities.values()] });
      if (pendingKeys.size > 0) { await this.lookupCached([...pendingKeys.values()]); state = await this.local.read() ?? state; }
      const { scanAfter: _previousCursor, ...next } = state;
      const after = page.length === 50 ? page.at(-1)?.id : undefined;
      await this.local.save(after === undefined ? next : { ...next, scanAfter: after });
    });
  }
}
