import { canonicalDateTime } from '../invariant';
import { createSourceEvidence } from './source-evidence-contract';
import type { SourceEvidence } from './source-evidence-contract';
import {
  favoriteAliasLimit,
  favoriteDiagnosticLimit,
  favoriteFolderSegmentByteLimit,
  favoriteFolderSegmentLimit,
  favoriteObservationByteLimit,
  favoriteTitleByteLimit,
  favoriteTransformationLimit,
  favoriteUrlByteLimit,
  providerCandidateLimit,
  utf8ByteLength,
} from './limits';
import type {
  FavoriteMatchMethod,
  FavoriteMediaKind,
  FavoritePipelineDiagnostic,
  FavoritePresence,
  FavoriteProgressionProof,
  FavoriteProgressionRejection,
  FavoriteProvider,
  FavoriteTransformation,
} from './vocabularies';

export * from './limits';
export { createSourceEvidence };
export type { SourceEvidence } from './source-evidence-contract';

export const favoriteContractVersion = 2 as const;

export interface FavoriteObservation {
  readonly bookmarkId: string;
  readonly folderPath: readonly string[];
  readonly observationRevision: string;
  readonly observationSequence: number;
  readonly observedAt: string;
  readonly presence: FavoritePresence;
  readonly siblingOrder: number;
  readonly title: string;
  readonly url: string;
}

export interface FavoriteParseArtifact {
  readonly contractVersion: typeof favoriteContractVersion;
  readonly diagnostics: readonly FavoritePipelineDiagnostic[];
  readonly identityKey?: string;
  readonly mediaKind: FavoriteMediaKind;
  readonly parserVersion: string;
  readonly progress?: Readonly<{ kind: 'chapter' | 'episode' | 'volume'; proof: FavoriteProgressionProof; rejections: readonly FavoriteProgressionRejection[]; value: number }>;
  readonly raw: Readonly<{ title: string; url: string }>;
  readonly season?: number;
  readonly semanticFingerprint: string;
  readonly sourceAdapterVersion: string;
  readonly sourceEvidence: SourceEvidence;
  readonly transformations: readonly FavoriteTransformation[];
}

export interface ProviderCandidate {
  readonly externalId: string;
  readonly format?: string;
  readonly mediaKind: Exclude<FavoriteMediaKind, 'UNKNOWN'>;
  readonly preSerialization: boolean;
  readonly provider: FavoriteProvider;
  readonly titles: readonly string[];
}

export interface ProviderCandidateEnvelope {
  readonly candidates: readonly ProviderCandidate[];
  readonly complete: boolean;
  readonly digest: string;
  readonly nextCursor?: string;
  readonly provider: FavoriteProvider;
  readonly truncated: boolean;
}

export interface ProviderCandidateReference {
  readonly externalId: string;
  readonly provider: FavoriteProvider;
}

export type ResolutionDecision =
  | Readonly<{ candidateReferences: readonly ProviderCandidateReference[]; kind: 'AMBIGUOUS'; level: FavoriteMatchMethod; reasons: readonly string[] }>
  | Readonly<{ candidateReferences: readonly ProviderCandidateReference[]; kind: 'NO_MATCH'; level: FavoriteMatchMethod; reasons: readonly string[] }>
  | Readonly<{ candidateReferences: readonly ProviderCandidateReference[]; kind: 'MATCH'; level: FavoriteMatchMethod; matchedReference: ProviderCandidateReference; reasons: readonly string[] }>;

function contract(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

function nonEmpty(value: string, field: string): string {
  contract(value.trim().length > 0, `${field} must not be empty.`);
  return value;
}

function boundedText(value: string, field: string, limit: number): string {
  nonEmpty(value, field);
  contract(utf8ByteLength(value) <= limit, `${field} exceeds ${limit} UTF-8 bytes.`);
  return value;
}

function boundedTexts(values: readonly string[], field: string, limit: number): readonly string[] {
  contract(Array.isArray(values) && values.length <= limit, `${field} exceeds ${limit} entries.`);
  return Object.freeze(values.map((value, index) => nonEmpty(value, `${field}[${index}]`)));
}

export function createFavoriteObservation(input: FavoriteObservation): FavoriteObservation {
  contract(Number.isSafeInteger(input.observationSequence) && input.observationSequence >= 0, 'observationSequence must be a non-negative safe integer.');
  contract(Number.isSafeInteger(input.siblingOrder) && input.siblingOrder >= 0, 'siblingOrder must be a non-negative safe integer.');
  contract(input.folderPath.length <= favoriteFolderSegmentLimit, `folderPath exceeds ${favoriteFolderSegmentLimit} segments.`);
  const folderPath = Object.freeze(input.folderPath.map((segment, index) => boundedText(segment, `folderPath[${index}]`, favoriteFolderSegmentByteLimit)));
  const observation = Object.freeze({
    ...input,
    bookmarkId: nonEmpty(input.bookmarkId, 'bookmarkId'),
    folderPath,
    observationRevision: nonEmpty(input.observationRevision, 'observationRevision'),
    observedAt: canonicalDateTime(input.observedAt, 'observedAt'),
    title: boundedText(input.title, 'title', favoriteTitleByteLimit),
    url: boundedText(input.url, 'url', favoriteUrlByteLimit),
  });
  contract(/^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/iu.test(observation.url), 'url must use HTTP(S).');
  contract(utf8ByteLength(JSON.stringify(observation)) <= favoriteObservationByteLimit, `observation exceeds ${favoriteObservationByteLimit} UTF-8 bytes.`);
  return observation;
}

export function createFavoriteParseArtifact(input: FavoriteParseArtifact): FavoriteParseArtifact {
  contract(input.contractVersion === favoriteContractVersion, `contractVersion must be ${favoriteContractVersion}.`);
  contract(input.transformations.length <= favoriteTransformationLimit, `transformations exceeds ${favoriteTransformationLimit} entries.`);
  contract(input.diagnostics.length <= favoriteDiagnosticLimit, `diagnostics exceeds ${favoriteDiagnosticLimit} entries.`);
  if (input.season !== undefined) contract(Number.isSafeInteger(input.season) && input.season > 0, 'season must be a positive safe integer.');
  if (input.progress !== undefined) contract(Number.isFinite(input.progress.value) && input.progress.value >= 0, 'progress.value must be finite and non-negative.');
  const { progress, ...rest } = input;
  const rawTitle = boundedText(input.raw.title, 'raw.title', favoriteTitleByteLimit);
  const rawUrl = boundedText(input.raw.url, 'raw.url', favoriteUrlByteLimit);
  contract(/^https?:\/\/[^\s/?#]+(?:[/?#][^\s]*)?$/iu.test(rawUrl), 'raw.url must use HTTP(S).');
  const artifact = {
    ...rest,
    diagnostics: Object.freeze([...input.diagnostics]),
    parserVersion: nonEmpty(input.parserVersion, 'parserVersion'),
    raw: Object.freeze({ title: rawTitle, url: rawUrl }),
    semanticFingerprint: nonEmpty(input.semanticFingerprint, 'semanticFingerprint'),
    sourceAdapterVersion: nonEmpty(input.sourceAdapterVersion, 'sourceAdapterVersion'),
    sourceEvidence: createSourceEvidence(input.sourceEvidence),
    transformations: Object.freeze([...input.transformations]),
  };
  if (progress === undefined) return Object.freeze(artifact);
  return Object.freeze({ ...artifact, progress: Object.freeze({ ...progress, rejections: Object.freeze([...progress.rejections]) }) });
}

function createProviderCandidate(input: ProviderCandidate, provider: FavoriteProvider): ProviderCandidate {
  contract(input.provider === provider, 'candidate provider must match its envelope.');
  contract(input.titles.length <= favoriteAliasLimit, `titles exceeds ${favoriteAliasLimit} entries.`);
  return Object.freeze({
    ...input,
    externalId: nonEmpty(input.externalId, 'externalId'),
    titles: Object.freeze(input.titles.map((title, index) => boundedText(title, `titles[${index}]`, favoriteTitleByteLimit))),
  });
}

export function createProviderCandidateEnvelope(input: ProviderCandidateEnvelope): ProviderCandidateEnvelope {
  contract(input.candidates.length <= providerCandidateLimit, `candidates exceeds ${providerCandidateLimit} entries.`);
  if (input.complete && input.truncated) throw new TypeError('a complete candidate envelope cannot be truncated.');
  if (input.nextCursor !== undefined) nonEmpty(input.nextCursor, 'nextCursor');
  return Object.freeze({
    ...input,
    candidates: Object.freeze(input.candidates.map((candidate) => createProviderCandidate(candidate, input.provider))),
    digest: nonEmpty(input.digest, 'digest'),
  });
}

function referenceKey(reference: ProviderCandidateReference): string {
  return `${reference.provider}:${reference.externalId}`;
}

function freezeReference(reference: ProviderCandidateReference): ProviderCandidateReference {
  return Object.freeze({ externalId: nonEmpty(reference.externalId, 'candidateReference.externalId'), provider: reference.provider });
}

export function createResolutionDecision(input: ResolutionDecision, envelopes: readonly ProviderCandidateEnvelope[]): ResolutionDecision {
  contract(envelopes.length > 0, 'a decision requires at least one provider envelope.');
  contract(new Set(envelopes.map((envelope) => envelope.provider)).size === envelopes.length, 'a decision accepts only one envelope per provider.');
  contract(envelopes.every((envelope) => envelope.complete && !envelope.truncated), 'INCOMPLETE_CANDIDATE_SET: a decision requires complete provider envelopes.');
  contract(envelopes.reduce((total, envelope) => total + envelope.candidates.length, 0) <= providerCandidateLimit, `a decision accepts at most ${providerCandidateLimit} candidates across providers.`);
  const available = new Set(envelopes.flatMap((envelope) => envelope.candidates.map((candidate) => referenceKey(candidate))));
  const references = input.candidateReferences.map(freezeReference);
  const referenceKeys = references.map(referenceKey);
  contract(referenceKeys.every((key) => available.has(key)), 'decision references an unknown candidate.');
  contract(new Set(referenceKeys).size === referenceKeys.length, 'decision candidate references must be unique.');
  if (input.kind === 'MATCH') {
    const matchedReference = freezeReference(input.matchedReference);
    contract(references.length === 1 && referenceKeys[0] === referenceKey(matchedReference), 'MATCH requires exactly its matched provider reference.');
    nonEmpty(input.level, 'level');
    return Object.freeze({ ...input, candidateReferences: Object.freeze(references), level: input.level, matchedReference, reasons: boundedTexts(input.reasons, 'reasons', favoriteDiagnosticLimit) });
  } else if (input.kind === 'AMBIGUOUS') {
    contract(references.length >= 2, 'AMBIGUOUS requires at least two distinct candidate references.');
  } else contract(references.length === 0, 'NO_MATCH cannot select a candidate reference.');
  nonEmpty(input.level, 'level');
  return Object.freeze({ ...input, candidateReferences: Object.freeze(references), level: input.level, reasons: boundedTexts(input.reasons, 'reasons', favoriteDiagnosticLimit) });
}
