import type { SourceEvidence } from './source-evidence-contract';
import type { FavoriteAliasProvenance, FavoriteMatchMethod, FavoriteMediaKind, FavoritePipelineDiagnostic, FavoriteProgressionProof, FavoriteProgressionRejection, FavoriteTransformation } from './vocabularies';

export interface FavoriteParseArtifact {
  readonly aliases?: readonly Readonly<{ provenance: FavoriteAliasProvenance; value: string }>[];
  readonly contractVersion: 2;
  readonly diagnostics: readonly FavoritePipelineDiagnostic[];
  readonly displayTitle?: string;
  readonly identityKey?: string;
  readonly matcherVersion?: string;
  readonly mediaKind: FavoriteMediaKind;
  readonly parserVersion: string;
  readonly progress?: Readonly<{ candidates?: readonly Readonly<{ kind: 'chapter' | 'episode' | 'volume'; position: number; proof: FavoriteProgressionProof; quality: number; raw: string; value: number }>[]; kind: 'chapter' | 'episode' | 'volume'; proof: FavoriteProgressionProof; raw?: string; rejections: readonly FavoriteProgressionRejection[]; value: number }>;
  readonly progressionParserVersion?: string;
  readonly raw: Readonly<{ title: string; url: string }>;
  readonly season?: number;
  readonly seasonEvidence?: Readonly<{ bareTrailingNumber?: number; canonicalSeason?: number; conflict: boolean; titleSeason?: number; urlSeason?: number }>;
  readonly segments?: readonly Readonly<{ cleaned: string; excluded: boolean; kind: 'hostname' | 'human' | 'number' | 'progression'; raw: string }>[];
  readonly semanticFingerprint: string;
  readonly sourceAdapterVersion: string;
  readonly sourceEvidence: SourceEvidence;
  readonly status?: 'identity-missing' | 'parsed';
  readonly transformations: readonly FavoriteTransformation[];
  readonly year?: number;
  readonly lastMatchMethod?: FavoriteMatchMethod;
}
