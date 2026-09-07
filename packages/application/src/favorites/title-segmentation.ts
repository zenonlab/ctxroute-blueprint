import { favoriteTitleByteLimit, utf8ByteLength } from '@tobirink/domain';
import type { FavoriteProgressionProof, FavoriteTransformation } from '@tobirink/domain';
import { normalizeFavoriteTitle } from './title-normalization';

export interface FavoriteReleaseCandidate {
  readonly kind: 'chapter' | 'episode' | 'volume';
  readonly position: number;
  readonly proof: Extract<FavoriteProgressionProof, 'explicit-marker' | 'separated-release'>;
  readonly raw: string;
  readonly value: number;
}

export interface FavoriteTitleSegment { readonly cleaned: string; readonly excluded: boolean; readonly kind: 'hostname' | 'human' | 'number' | 'progression'; readonly raw: string }
export interface FavoriteTitleAnalysis {
  readonly bareTrailingNumber?: Readonly<{ raw: string; value: number }>;
  readonly cleanedTitle: string;
  readonly releases: readonly FavoriteReleaseCandidate[];
  readonly segments: readonly FavoriteTitleSegment[];
  readonly transformations: readonly FavoriteTransformation[];
  readonly year?: number;
}

const explicitRelease = /(?:^|\s)(chapter|chapitre|ch|episode|épisode|ep|volume|vol)\s*[-:#.]?\s*(\d+(?:[.,]\d+)?)/giu;
const separatedRelease = /\b(\d+(?:[.,]\d+)?)\s+(vostfr|vf|vo|sub|dub)\b/giu;
const separator = /\s*(?:\||·|—|–|\s-\s)\s*/u;

function releaseKind(label: string): FavoriteReleaseCandidate['kind'] {
  if (/^(?:episode|épisode|ep)$/iu.test(label)) return 'episode';
  if (/^(?:volume|vol)$/iu.test(label)) return 'volume';
  return 'chapter';
}

function collectReleases(title: string): readonly FavoriteReleaseCandidate[] {
  const candidates: FavoriteReleaseCandidate[] = [];
  for (const match of title.matchAll(explicitRelease)) {
    const label = match[1]; const raw = match[2];
    if (label !== undefined && raw !== undefined) candidates.push({ kind: releaseKind(label), position: match.index, proof: 'explicit-marker', raw, value: Number(raw.replace(',', '.')) });
  }
  for (const match of title.matchAll(separatedRelease)) {
    const raw = match[1];
    if (raw !== undefined) candidates.push({ kind: 'episode', position: match.index, proof: 'separated-release', raw, value: Number(raw.replace(',', '.')) });
  }
  return Object.freeze(candidates);
}

function hostnameLabels(hostname?: string): readonly string[] {
  if (hostname === undefined) return [];
  const host = hostname.toLowerCase().replace(/^www\./u, '');
  return Object.freeze([host, host.split('.')[0] ?? host]);
}

export function segmentFavoriteTitle(title: string, hostname?: string): FavoriteTitleAnalysis {
  if (title.trim().length === 0) throw new TypeError('title must not be empty.');
  if (utf8ByteLength(title) > favoriteTitleByteLimit) throw new RangeError(`title exceeds ${favoriteTitleByteLimit} UTF-8 bytes.`);
  const transformations: FavoriteTransformation[] = [];
  const releases = collectReleases(title);
  const labels = hostnameLabels(hostname);
  let cleaned = title.replace(/\s+/gu, ' ').trim();
  for (let pass = 0; pass < 5; pass += 1) {
    const before = cleaned;
    cleaned = cleaned.replace(/^(?:read|watch|lire|regarder(?:\s+gratuitement)?)\s*[:|·—–-]?\s+/iu, () => { transformations.push('cleaned_generic_suffix'); return ''; });
    cleaned = cleaned.replace(/^\((?=[^)]*(?:vostfr|vf|vo|sub|dub|scan))[^)]*(?:oav|ova)[^)]*\)\s*/iu, () => { transformations.push('cleaned_generic_suffix'); return ''; });
    cleaned = cleaned.replace(/\s+(?:chapter|chapitre|ch|episode|épisode|ep|volume|vol)\s*[-:#.]?\s*\d+(?:[.,]\d+)?\s*$/iu, () => { transformations.push('excluded_progression'); return ''; });
    cleaned = cleaned.replace(/\s+\d+(?:[.,]\d+)?\s+(?:vostfr|vf|vo|sub|dub|scan)\s*$/iu, () => { transformations.push('excluded_progression'); return ''; });
    cleaned = cleaned.replace(/\s+(?:in english online free|online free|free online|read online|en hd|lire en ligne|new (?:chapters|chapitres|episodes|volumes|releases|sorties))\s*$/iu, () => { transformations.push('cleaned_generic_suffix'); return ''; });
    cleaned = cleaned.replace(/\s*(?:\||·|—|–|\s-\s)\s*(?:vostfr|vf|vo|sub|dub|scan)\s*$/iu, () => { transformations.push('cleaned_generic_suffix'); return ''; });
    const parts = cleaned.split(separator);
    if (parts.length > 1 && labels.includes(normalizeFavoriteTitle(parts.at(-1) ?? '').normalized)) { parts.pop(); cleaned = parts.join(' | '); transformations.push('excluded_observed_hostname'); }
    cleaned = cleaned.replace(/[\s|·—–-]+$/gu, '').trim();
    if (cleaned === before) break;
  }
  const unique: string[] = [];
  for (const part of cleaned.split(separator).filter(Boolean)) {
    const key = normalizeFavoriteTitle(part).normalized;
    if (unique.some((value) => normalizeFavoriteTitle(value).normalized === key)) transformations.push('repeated-human-title');
    else unique.push(part);
  }
  cleaned = unique.join(' | ');
  const yearMatch = cleaned.match(/(?:^|[\s(])(19\d{2}|20\d{2})\)?\s*$/u);
  const ordinal = /\b\d{1,2}(?:st|nd|rd|th|er|e|eme|ème)\s*$/iu.test(cleaned);
  const bareMatch = ordinal || yearMatch !== null ? null : cleaned.match(/(?:^|\s)(\d+(?:[.,]\d+)?)\s*$/u);
  const bareRaw = bareMatch?.[1];
  const segments = title.split(separator).filter(Boolean).map((raw) => {
    const progression = explicitRelease.test(raw) || separatedRelease.test(raw); explicitRelease.lastIndex = 0; separatedRelease.lastIndex = 0;
    const normalized = normalizeFavoriteTitle(raw).normalized;
    const kind = progression ? 'progression' as const : labels.includes(normalized) ? 'hostname' as const : /^\d+(?:[.,]\d+)?$/u.test(raw.trim()) ? 'number' as const : 'human' as const;
    return Object.freeze({ cleaned: raw.replace(/\s+/gu, ' ').trim(), excluded: kind !== 'human', kind, raw });
  });
  const base = { cleanedTitle: cleaned, releases, segments: Object.freeze(segments), transformations: Object.freeze(transformations) };
  const withYear = yearMatch?.[1] === undefined ? base : { ...base, year: Number(yearMatch[1]) };
  return Object.freeze(bareRaw === undefined ? withYear : { ...withYear, bareTrailingNumber: Object.freeze({ raw: bareRaw, value: Number(bareRaw.replace(',', '.')) }) });
}
