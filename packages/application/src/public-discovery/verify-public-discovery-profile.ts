import type { ProviderCandidate } from '@tobirink/domain';
import { stripFavoriteSeasonSuffix } from '../favorites/season-extraction';
import { normalizeFavoriteTitle } from '../favorites/title-normalization';
import { publicDiscoveryProfileSchema, type PublicDiscoveryKey, type PublicDiscoveryProfile } from './public-discovery-contract';

async function fingerprint(mediaKind: PublicDiscoveryKey['mediaKind'], season: number | null, identity: string): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify([1, mediaKind, season, identity]));
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function compatible(key: PublicDiscoveryKey, candidate: ProviderCandidate): boolean {
  if (key.mediaKind === 'UNKNOWN') return true;
  if (key.mediaKind === 'ANIME') return candidate.mediaKind === 'ANIME';
  return candidate.mediaKind !== 'ANIME';
}

export async function verifiedPublicDiscoveryProfile(key: PublicDiscoveryKey, candidate: ProviderCandidate): Promise<PublicDiscoveryProfile | undefined> {
  if (!compatible(key, candidate)) return undefined;
  let matched = false;
  for (const title of candidate.titles.slice(0, 16)) {
    const normalized = normalizeFavoriteTitle(title).normalized;
    if (normalized.length === 0) continue;
    if (await fingerprint(key.mediaKind, null, normalized) === key.fingerprint) matched = true;
    for (let season = 1; !matched && season <= 99; season += 1) {
      const identity = stripFavoriteSeasonSuffix(normalized, season);
      if (await fingerprint(key.mediaKind, season, identity) === key.fingerprint) matched = true;
    }
    if (matched) break;
  }
  if (!matched) return undefined;
  const variants = candidate.titleVariants ?? candidate.titles.map((title) => ({ title }));
  const officialTitles = [...new Map(variants.slice(0, 16).map((variant) => {
    const locale = (('language' in variant ? variant.language : undefined) ?? 'und').replaceAll('_', '-').slice(0, 16);
    return [`${locale}:${variant.title}`, { locale, title: variant.title }] as const;
  })).values()].slice(0, 8);
  if (officialTitles.length === 0) officialTitles.push({ locale: 'und', title: candidate.titles[0] ?? candidate.displayTitle ?? 'Untitled' });
  const provider = candidate.provider;
  return publicDiscoveryProfileSchema.parse({
    mediaKind: candidate.mediaKind === 'ANIME' ? 'anime' : 'manga',
    officialTitles,
    preferredTitle: candidate.displayTitle ?? officialTitles[0]?.title,
    references: [{ externalId: candidate.externalId, provider }],
    workId: `work_${provider.replaceAll('-', '_')}_${candidate.externalId.replaceAll('-', '_')}`.slice(0, 128),
  });
}
