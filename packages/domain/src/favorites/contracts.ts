import { canonicalDateTime } from '../invariant';
import { createSourceEvidence } from './source-evidence-contract';
import type { FavoriteParseArtifact } from './parse-artifact-contract';
import {
  favoriteDiagnosticLimit,
  favoriteFolderSegmentByteLimit,
  favoriteFolderSegmentLimit,
  favoriteObservationByteLimit,
  favoriteParseArtifactByteLimit,
  favoriteTitleByteLimit,
  favoriteTransformationLimit,
  favoriteUrlByteLimit,
  providerCandidateLimit,
  providerMetadataCollectionLimit,
  providerFacetValueByteLimit,
  utf8ByteLength,
} from './limits';
import type {
  FavoriteMatchMethod,
  FavoriteMediaKind,
  FavoritePresence,
  FavoriteProvider,
} from './vocabularies';

export * from './limits';
export { createSourceEvidence };
export type { SourceEvidence } from './source-evidence-contract';
export type { FavoriteParseArtifact } from './parse-artifact-contract';

export const favoriteContractVersion = 2 as const;
export const providerMetadataVersion = 2 as const;
export const supportedProviderMetadataVersions = [1, providerMetadataVersion] as const;

export const providerEditorialStatuses = ['UPCOMING', 'ONGOING', 'HIATUS', 'COMPLETED', 'CANCELLED', 'UNKNOWN'] as const;
export type ProviderEditorialStatus = (typeof providerEditorialStatuses)[number];

export interface ProviderPopularity {
  readonly kind: 'MEMBERS' | 'RANK';
  readonly value: number;
}

export interface ProviderCover {
  readonly attribution: string;
  readonly url: string;
}

export interface ProviderTitleVariant {
  readonly language?: string;
  readonly title: string;
}

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

export interface ProviderCandidate {
  contentClassification?: 'adult' | 'non-adult' | 'unknown';
  readonly linkedReferences?: readonly ProviderCandidateReference[];
  readonly canonicalUrl?: string;
  readonly categories?: readonly string[];
  readonly externalId: string;
  readonly format?: string;
  readonly genres?: readonly string[];
  readonly editorialStatus?: ProviderEditorialStatus;
  readonly startYear?: number;
  readonly endYear?: number;
  readonly episodeCount?: number;
  readonly chapterCount?: number;
  readonly volumeCount?: number;
  readonly popularity?: ProviderPopularity;
  readonly cover?: ProviderCover;
  readonly displayTitle?: string;
  readonly titleVariants?: readonly ProviderTitleVariant[];
  readonly metadataVersion?: (typeof supportedProviderMetadataVersions)[number];
  readonly mediaKind: Exclude<FavoriteMediaKind, 'UNKNOWN'>;
  readonly preSerialization: boolean;
  readonly provider: FavoriteProvider;
  readonly season?: number;
  readonly titles: readonly string[];
}

export function isContentVisible(candidate: ProviderCandidate | undefined, showAdultContent: boolean): boolean {
  return showAdultContent || candidate?.contentClassification !== 'adult';
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

function boundedTexts(values: readonly string[], field: string, limit: number, byteLimit = favoriteTitleByteLimit): readonly string[] {
  contract(Array.isArray(values) && values.length <= limit, `${field} exceeds ${limit} entries.`);
  return Object.freeze(values.map((value, index) => boundedText(value, `${field}[${index}]`, byteLimit)));
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
  contract(utf8ByteLength(JSON.stringify(observation)) <= favoriteObservationByteLimit, `observation exceeds ${favoriteObservationByteLimit} UTF-8 bytes.`);
  return observation;
}

function rawUrlDisposition(value: string): 'INVALID_URL' | 'NON_WEB_URL' | undefined {
  let parsed: URL;
  try { parsed = new URL(value); } catch { return 'INVALID_URL'; }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? undefined : 'NON_WEB_URL';
}

export function createFavoriteParseArtifact(input: FavoriteParseArtifact): FavoriteParseArtifact {
  contract(input.contractVersion === favoriteContractVersion, `contractVersion must be ${favoriteContractVersion}.`);
  contract(input.transformations.length <= favoriteTransformationLimit, `transformations exceeds ${favoriteTransformationLimit} entries.`);
  contract(input.diagnostics.length <= favoriteDiagnosticLimit, `diagnostics exceeds ${favoriteDiagnosticLimit} entries.`);
  if (input.season !== undefined) contract(Number.isSafeInteger(input.season) && input.season > 0, 'season must be a positive safe integer.');
  if (input.progress !== undefined) contract(Number.isFinite(input.progress.value) && input.progress.value >= 0, 'progress.value must be finite and non-negative.');
  const { aliases, progress, seasonEvidence, segments, ...rest } = input;
  const rawTitle = boundedText(input.raw.title, 'raw.title', favoriteTitleByteLimit);
  const rawUrl = boundedText(input.raw.url, 'raw.url', favoriteUrlByteLimit);
  const sourceEvidence = createSourceEvidence(input.sourceEvidence);
  const requiredDisposition = rawUrlDisposition(rawUrl);
  if (requiredDisposition !== undefined) contract(sourceEvidence.disposition === requiredDisposition, `raw.url requires ${requiredDisposition} source evidence.`);
  const artifact = {
    ...rest,
    diagnostics: Object.freeze([...input.diagnostics]),
    parserVersion: nonEmpty(input.parserVersion, 'parserVersion'),
    raw: Object.freeze({ title: rawTitle, url: rawUrl }),
    semanticFingerprint: nonEmpty(input.semanticFingerprint, 'semanticFingerprint'),
    sourceAdapterVersion: nonEmpty(input.sourceAdapterVersion, 'sourceAdapterVersion'),
    sourceEvidence,
    transformations: Object.freeze([...input.transformations]),
  };
  if (aliases !== undefined) Object.assign(artifact, { aliases: Object.freeze(aliases.map((alias) => Object.freeze({ ...alias }))) });
  if (seasonEvidence !== undefined) Object.assign(artifact, { seasonEvidence: Object.freeze({ ...seasonEvidence }) });
  if (segments !== undefined) Object.assign(artifact, { segments: Object.freeze(segments.map((segment) => Object.freeze({ ...segment }))) });
  let result: FavoriteParseArtifact;
  if (progress === undefined) result = Object.freeze(artifact);
  else {
    const frozenProgress = { ...progress, rejections: Object.freeze([...progress.rejections]) };
    if (progress.candidates !== undefined) Object.assign(frozenProgress, { candidates: Object.freeze(progress.candidates.map((candidate) => Object.freeze({ ...candidate }))) });
    result = Object.freeze({ ...artifact, progress: Object.freeze(frozenProgress) });
  }
  contract(utf8ByteLength(JSON.stringify(result)) <= favoriteParseArtifactByteLimit, `artifact exceeds ${favoriteParseArtifactByteLimit} UTF-8 bytes.`);
  return result;
}

export function createProviderCandidate(input: ProviderCandidate, provider: FavoriteProvider): ProviderCandidate {
  contract(input.provider === provider, 'candidate provider must match its envelope.');
  if (input.contentClassification !== undefined) {
    contract(['adult', 'non-adult', 'unknown'].includes(input.contentClassification), 'contentClassification is invalid.');
  }
  contract(input.titles.length <= providerMetadataCollectionLimit, `titles exceeds ${providerMetadataCollectionLimit} entries.`);
  if (input.season !== undefined) contract(Number.isSafeInteger(input.season) && input.season > 0, 'candidate season must be a positive safe integer.');
  for (const [field, value] of Object.entries({ startYear: input.startYear, endYear: input.endYear })) {
    if (value !== undefined) contract(Number.isSafeInteger(value) && value >= 1800 && value <= 3000, `${field} must be a plausible year.`);
  }
  if (input.startYear !== undefined && input.endYear !== undefined) contract(input.endYear >= input.startYear, 'endYear cannot precede startYear.');
  for (const [field, value] of Object.entries({ episodeCount: input.episodeCount, chapterCount: input.chapterCount, volumeCount: input.volumeCount })) {
    if (value !== undefined) contract(Number.isSafeInteger(value) && value >= 0, `${field} must be a non-negative safe integer.`);
  }
  if (input.editorialStatus !== undefined) contract(providerEditorialStatuses.includes(input.editorialStatus), 'editorialStatus is invalid.');
  if (input.metadataVersion !== undefined) contract(supportedProviderMetadataVersions.includes(input.metadataVersion), `metadataVersion must be one of ${supportedProviderMetadataVersions.join(', ')}.`);
  if (input.popularity !== undefined) {
    contract(input.popularity.kind === 'MEMBERS' || input.popularity.kind === 'RANK', 'popularity.kind is invalid.');
    contract(Number.isSafeInteger(input.popularity.value) && input.popularity.value >= 0, 'popularity.value must be a non-negative safe integer.');
  }
  let canonicalUrl: string | undefined;
  if (input.canonicalUrl !== undefined) {
    const parsed = new URL(boundedText(input.canonicalUrl, 'canonicalUrl', favoriteUrlByteLimit));
    contract(parsed.protocol === 'http:' || parsed.protocol === 'https:', 'canonicalUrl must use HTTP(S).');
    canonicalUrl = parsed.href;
  }
  let cover: ProviderCover | undefined;
  if (input.cover !== undefined) {
    const parsed = new URL(boundedText(input.cover.url, 'cover.url', favoriteUrlByteLimit));
    contract(parsed.protocol === 'https:', 'cover.url must use HTTPS.');
    const allowedHosts: Readonly<Record<FavoriteProvider, readonly string[]>> = {
      anilist: ['s4.anilist.co'],
      mangaupdates: ['cdn.mangaupdates.com'],
      mangadex: ['uploads.mangadex.org'],
      'kitsu-anime': ['media.kitsu.app'],
      'kitsu-manga': ['media.kitsu.app'],
    };
    contract(allowedHosts[provider].includes(parsed.hostname), `cover.url origin is not allowed for ${provider}.`);
    cover = Object.freeze({ attribution: boundedText(input.cover.attribution, 'cover.attribution', providerFacetValueByteLimit), url: parsed.href });
  }
  const titleVariants = input.titleVariants === undefined ? undefined : Object.freeze(input.titleVariants.map((variant, index) => {
    const title = boundedText(variant.title, `titleVariants[${index}].title`, favoriteTitleByteLimit);
    return Object.freeze(variant.language === undefined
      ? { title }
      : { language: boundedText(variant.language, `titleVariants[${index}].language`, providerFacetValueByteLimit), title });
  }));
  contract((titleVariants?.length ?? 0) <= providerMetadataCollectionLimit, `titleVariants exceeds ${providerMetadataCollectionLimit} entries.`);
  const candidate = {
    externalId: boundedText(input.externalId, 'externalId', favoriteTitleByteLimit),
    mediaKind: input.mediaKind,
    preSerialization: input.preSerialization,
    provider: input.provider,
    titles: Object.freeze(input.titles.map((title, index) => boundedText(title, `titles[${index}]`, favoriteTitleByteLimit))),
  };
  if (input.contentClassification !== undefined) Object.assign(candidate, { contentClassification: input.contentClassification });
  if (input.format !== undefined) Object.assign(candidate, { format: boundedText(input.format, 'format', providerFacetValueByteLimit) });
  if (input.season !== undefined) Object.assign(candidate, { season: input.season });
  if (input.categories !== undefined) Object.assign(candidate, { categories: boundedTexts(input.categories, 'categories', providerMetadataCollectionLimit, providerFacetValueByteLimit) });
  if (input.genres !== undefined) Object.assign(candidate, { genres: boundedTexts(input.genres, 'genres', providerMetadataCollectionLimit, providerFacetValueByteLimit) });
  if (input.editorialStatus !== undefined) Object.assign(candidate, { editorialStatus: input.editorialStatus });
  if (input.startYear !== undefined) Object.assign(candidate, { startYear: input.startYear });
  if (input.endYear !== undefined) Object.assign(candidate, { endYear: input.endYear });
  if (input.episodeCount !== undefined) Object.assign(candidate, { episodeCount: input.episodeCount });
  if (input.chapterCount !== undefined) Object.assign(candidate, { chapterCount: input.chapterCount });
  if (input.volumeCount !== undefined) Object.assign(candidate, { volumeCount: input.volumeCount });
  if (input.popularity !== undefined) Object.assign(candidate, { popularity: Object.freeze({ ...input.popularity }) });
  if (cover !== undefined) Object.assign(candidate, { cover });
  if (input.displayTitle !== undefined) Object.assign(candidate, { displayTitle: boundedText(input.displayTitle, 'displayTitle', favoriteTitleByteLimit) });
  if (titleVariants !== undefined) Object.assign(candidate, { titleVariants });
  if (input.metadataVersion !== undefined) Object.assign(candidate, { metadataVersion: input.metadataVersion });
  if (canonicalUrl !== undefined) Object.assign(candidate, { canonicalUrl });
  if (input.linkedReferences !== undefined) {
    contract(input.linkedReferences.length <= 5, 'linkedReferences exceeds five providers.');
    contract(new Set(input.linkedReferences.map(reference => reference.provider)).size === input.linkedReferences.length, 'linkedReferences requires distinct providers.');
    for (const reference of input.linkedReferences) {
      contract(['anilist', 'mangaupdates', 'mangadex', 'kitsu-anime', 'kitsu-manga'].includes(reference.provider), 'linked reference provider is invalid.');
      boundedText(reference.externalId, 'linkedReferences.externalId', favoriteTitleByteLimit);
    }
    Object.assign(candidate, { linkedReferences: Object.freeze(input.linkedReferences.map(freezeReference)) });
  }
  return Object.freeze(candidate);
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
