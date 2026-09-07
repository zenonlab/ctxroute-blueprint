import type { FavoriteMediaKind, FavoriteProgressionProof, FavoriteProgressionRejection, SourceEvidence } from '@tobirink/domain';
import { normalizeFavoriteTitle } from './title-normalization';
import type { FavoriteSeasonAnalysis } from './season-extraction';
import type { FavoriteReleaseCandidate, FavoriteTitleAnalysis } from './title-segmentation';

export interface FavoriteProgressionCandidate { readonly kind: 'chapter' | 'episode' | 'volume'; readonly position: number; readonly proof: FavoriteProgressionProof; readonly quality: number; readonly raw: string; readonly value: number }
export interface FavoriteProgressionAnalysis { readonly candidates: readonly FavoriteProgressionCandidate[]; readonly kind: 'chapter' | 'episode' | 'volume'; readonly proof: FavoriteProgressionProof; readonly raw: string; readonly rejections: readonly FavoriteProgressionRejection[]; readonly value: number }

function defaultKind(mediaKind: FavoriteMediaKind): 'chapter' | 'episode' | undefined {
  if (mediaKind === 'ANIME') return 'episode';
  if (mediaKind === 'MANGA') return 'chapter';
  return undefined;
}

function fromTitle(candidate: FavoriteReleaseCandidate): FavoriteProgressionCandidate {
  return Object.freeze({ ...candidate, quality: candidate.proof === 'explicit-marker' ? 5 : 3 });
}

export function extractFavoriteProgression(input: { readonly aliases: readonly string[]; readonly evidence: SourceEvidence; readonly mediaKind: FavoriteMediaKind; readonly season: FavoriteSeasonAnalysis; readonly title: string; readonly titleAnalysis: FavoriteTitleAnalysis }): FavoriteProgressionAnalysis | undefined {
  const candidates: FavoriteProgressionCandidate[] = input.titleAnalysis.releases.map(fromTitle);
  const sourceRelease = input.evidence.release;
  if (sourceRelease?.value !== undefined) candidates.push({ kind: sourceRelease.kind, position: input.title.length + 1, proof: 'labelled-url-path', quality: 4, raw: sourceRelease.raw, value: sourceRelease.value });
  const fallbackKind = defaultKind(input.mediaKind);
  const pathParts = input.evidence.path?.split('/').filter(Boolean) ?? [];
  const terminal = pathParts.at(-1);
  const sourceIdentity = input.evidence.stableSlug !== undefined || input.evidence.title !== undefined || input.evidence.explicitProviderReference !== undefined;
  if (fallbackKind !== undefined && terminal !== undefined && /^\d+(?:[.,]\d+)?$/u.test(terminal) && sourceIdentity) {
    const previous = pathParts.at(-2)?.toLowerCase();
    const isSeason = (previous === 'season' || previous === 'saison') && Number(terminal) === input.season.canonicalSeason;
    if (!isSeason) candidates.push({ kind: fallbackKind, position: input.title.length + 2, proof: 'numeric-url-segment-after-source-identity', quality: 1, raw: terminal, value: Number(terminal.replace(',', '.')) });
  }
  const bare = input.titleAnalysis.bareTrailingNumber;
  if (bare !== undefined && fallbackKind !== undefined) {
    const base = input.title.slice(0, input.title.lastIndexOf(bare.raw)).trim();
    const aligned = input.aliases.some((alias) => normalizeFavoriteTitle(alias).normalized === normalizeFavoriteTitle(base).normalized);
    if (aligned) candidates.push({ kind: fallbackKind, position: input.title.lastIndexOf(bare.raw), proof: input.season.conflict ? 'season-divergence' : 'bare-number-after-validated-identity', quality: input.season.conflict ? 2 : 1, raw: bare.raw, value: bare.value });
  }
  if (candidates.length === 0) return undefined;
  const ordered = [...candidates].sort((left, right) => right.quality - left.quality || right.position - left.position);
  const selected = ordered[0];
  if (selected === undefined) return undefined;
  const rejections = ordered.slice(1).map((candidate): FavoriteProgressionRejection => {
    if (candidate.kind !== selected.kind) return 'INCOMPATIBLE_KIND';
    if (selected.quality === 5 && candidate.quality < 5) return 'EXPLICIT_EVIDENCE_PRESENT';
    if (candidate.quality < selected.quality) return 'LOWER_QUALITY_EVIDENCE';
    return 'EARLIER_SAME_QUALITY_EVIDENCE';
  });
  return Object.freeze({ candidates: Object.freeze(candidates), kind: selected.kind, proof: selected.proof, raw: selected.raw, rejections: Object.freeze(rejections), value: selected.value });
}
