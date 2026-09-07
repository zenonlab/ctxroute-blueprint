import { favoriteAliasLimit, favoriteDiagnosticLimit, favoriteEvidenceLimit, favoriteTitleByteLimit, favoriteUrlByteLimit, utf8ByteLength } from './limits';
import type { FavoriteAliasProvenance, FavoriteMediaKind, FavoritePipelineDiagnostic, FavoriteProvider, FavoriteReleaseProvenance, FavoriteRouteProof, FavoriteSourceStrategy, FavoriteUrlDisposition } from './vocabularies';

export interface SourceEvidence {
  readonly aliases: readonly Readonly<{ provenance: FavoriteAliasProvenance; value: string }>[];
  readonly canonicalUrl?: string;
  readonly diagnostics: readonly FavoritePipelineDiagnostic[];
  readonly disposition?: FavoriteUrlDisposition;
  readonly explicitProviderReference?: Readonly<{ externalId: string; provider: FavoriteProvider }>;
  readonly key: string;
  readonly mediaKind: FavoriteMediaKind;
  readonly origin?: string;
  readonly path?: string;
  readonly proofs: readonly FavoriteRouteProof[];
  readonly rawSlug?: string;
  readonly release?: Readonly<{ kind: 'chapter' | 'episode' | 'volume'; provenance: FavoriteReleaseProvenance; raw: string; value?: number }>;
  readonly releaseSuffix?: string;
  readonly season?: number;
  readonly sourceAdapter: string;
  readonly stableSlug?: string;
  readonly strategy: FavoriteSourceStrategy;
  readonly title?: string;
}

function requireValue(value: string, field: string, limit = favoriteTitleByteLimit): string {
  if (value.trim().length === 0) throw new TypeError(`${field} must not be empty.`);
  if (utf8ByteLength(value) > limit) throw new TypeError(`${field} exceeds ${limit} UTF-8 bytes.`);
  return value;
}

function requireWebUrl(value: string, field: string): { readonly origin: string } {
  const bounded = requireValue(value, field, favoriteUrlByteLimit);
  let parsed: URL;
  try { parsed = new URL(bounded); } catch { throw new TypeError(`${field} must use HTTP(S).`); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new TypeError(`${field} must use HTTP(S).`);
  return parsed;
}

export function createSourceEvidence(input: SourceEvidence): SourceEvidence {
  if (input.aliases.length > favoriteAliasLimit) throw new TypeError(`aliases exceeds ${favoriteAliasLimit} entries.`);
  if (input.diagnostics.length > favoriteDiagnosticLimit) throw new TypeError(`diagnostics exceeds ${favoriteDiagnosticLimit} entries.`);
  if (input.proofs.length > favoriteEvidenceLimit) throw new TypeError(`proofs exceeds ${favoriteEvidenceLimit} entries.`);
  if (input.season !== undefined && (!Number.isSafeInteger(input.season) || input.season <= 0)) throw new TypeError('source season must be a positive safe integer.');
  if (input.release?.value !== undefined && (!Number.isFinite(input.release.value) || input.release.value < 0)) throw new TypeError('release value must be finite and non-negative.');
  const canonicalUrl = input.canonicalUrl === undefined ? undefined : requireWebUrl(input.canonicalUrl, 'canonicalUrl');
  const origin = input.origin === undefined ? undefined : requireWebUrl(input.origin, 'origin');
  if (origin !== undefined && origin.origin !== input.origin) throw new TypeError('origin must be an HTTP(S) origin.');
  if (canonicalUrl !== undefined && origin !== undefined && canonicalUrl.origin !== origin.origin) throw new TypeError('canonicalUrl must use the declared origin.');
  if (input.explicitProviderReference !== undefined) requireValue(input.explicitProviderReference.externalId, 'explicitProviderReference.externalId');
  if (input.path !== undefined) requireValue(input.path, 'path', favoriteUrlByteLimit);
  if (input.rawSlug !== undefined) requireValue(input.rawSlug, 'rawSlug', favoriteUrlByteLimit);
  if (input.release !== undefined) requireValue(input.release.raw, 'release.raw');
  if (input.releaseSuffix !== undefined) requireValue(input.releaseSuffix, 'releaseSuffix');
  if (input.stableSlug !== undefined) requireValue(input.stableSlug, 'stableSlug', favoriteUrlByteLimit);
  if (input.title !== undefined) requireValue(input.title, 'title');
  if (input.disposition !== undefined) {
    const hasActionableEvidence = input.aliases.length > 0
      || input.proofs.length > 0
      || [input.canonicalUrl, input.explicitProviderReference, input.origin, input.path, input.rawSlug, input.release, input.releaseSuffix, input.season, input.stableSlug, input.title].some((value) => value !== undefined);
    if (input.mediaKind !== 'UNKNOWN' || hasActionableEvidence) throw new TypeError('rejected source evidence must not contain actionable identity evidence.');
  }
  const { explicitProviderReference, release, ...values } = input;
  const evidence = {
    ...values,
    aliases: Object.freeze(input.aliases.map((alias, index) => Object.freeze({ ...alias, value: requireValue(alias.value, `aliases[${index}].value`) }))),
    diagnostics: Object.freeze([...input.diagnostics]),
    key: requireValue(input.key, 'key'),
    proofs: Object.freeze([...input.proofs]),
    sourceAdapter: requireValue(input.sourceAdapter, 'sourceAdapter'),
  };
  const withReference = explicitProviderReference === undefined
    ? evidence
    : { ...evidence, explicitProviderReference: Object.freeze({ ...explicitProviderReference }) };
  return Object.freeze(release === undefined ? withReference : { ...withReference, release: Object.freeze({ ...release }) });
}
