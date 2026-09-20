import { createSourceEvidence } from '@tobirink/domain';
import type { FavoriteIdentityTransformation, SourceEvidence } from '@tobirink/domain';
import { z } from 'zod';
import type { FavoriteSourceAdapter } from './source-evidence';

const segmentText = z.string().min(1).max(80).regex(/^[\p{L}\p{N}._-]+$/u);
const segmentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('literal'), values: z.array(segmentText).min(1).max(16) }),
  z.strictObject({ kind: z.literal('identity'), prefix: z.literal('opaque-5').optional(), routingSuffixDigits: z.literal(3).optional() }),
  z.strictObject({ kind: z.literal('number'), prefix: segmentText.optional(), format: z.literal('id-chapter').optional(), maximum: z.number().int().min(1).max(100_000) }),
]);
const ruleSchema = z.strictObject({
  id: z.string().min(1).max(100), identitySegment: z.number().int().min(0).max(7),
  mediaKind: z.enum(['ANIME', 'MANGA', 'MANHWA', 'MANHUA', 'UNKNOWN']),
  origin: z.url().refine((value) => { const url = new URL(value); return url.protocol === 'https:' && url.origin === value && /^[a-z0-9.-]+$/u.test(url.hostname); }),
  release: z.strictObject({ kind: z.enum(['chapter', 'episode', 'volume']), segment: z.number().int().min(0).max(7) }).optional(),
  seasonSegment: z.number().int().min(0).max(7).optional(), segments: z.array(segmentSchema).min(2).max(8),
}).superRefine((rule, context) => {
  if (rule.segments[rule.identitySegment]?.kind !== 'identity') context.addIssue({ code: 'custom', message: 'identitySegment must name an identity segment.' });
  for (const index of [rule.seasonSegment, rule.release?.segment]) {
    if (index !== undefined && rule.segments[index]?.kind !== 'number') context.addIssue({ code: 'custom', message: 'Season and release must name numeric segments.' });
  }
});

export const favoriteSiteRulesSchema = z.strictObject({
  schemaVersion: z.literal(1), version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), rules: z.array(ruleSchema).max(100),
}).superRefine((snapshot, context) => {
  if (new Set(snapshot.rules.map((rule) => rule.id)).size !== snapshot.rules.length) context.addIssue({ code: 'custom', message: 'Rule IDs must be unique.' });
  if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > 64 * 1024) context.addIssue({ code: 'custom', message: 'Site rules exceed the byte budget.' });
});
export type FavoriteSiteRules = z.infer<typeof favoriteSiteRulesSchema>;
type Segment = z.infer<typeof segmentSchema>;
type MutableSourceEvidence = { -readonly [Key in keyof SourceEvidence]: SourceEvidence[Key] };

function numberValue(segment: Extract<Segment, { kind: 'number' }>, value: string): number | undefined {
  if (segment.format === 'id-chapter') {
    const match = /^\d{1,12}-chapter-(\d{1,6}(?:\.\d{1,3})?)$/u.exec(value);
    const number = match === null ? NaN : Number(match[1]);
    return number >= 0 && number <= segment.maximum ? number : undefined;
  }
  const prefix = segment.prefix ?? '';
  if (!value.startsWith(prefix)) return undefined;
  const raw = value.slice(prefix.length);
  if (!/^\d{1,6}(?:\.\d{1,3})?$/u.test(raw)) return undefined;
  const number = Number(raw);
  return number > 0 && number <= segment.maximum ? number : undefined;
}

function matches(segment: Segment, value: string): boolean {
  if (segment.kind === 'literal') return segment.values.includes(value);
  if (segment.kind === 'number') return numberValue(segment, value) !== undefined;
  if (segment.prefix === 'opaque-5' && !/^[a-z0-9]{4,5}-.{2,250}$/u.test(value)) return false;
  return value.length >= 2 && value.length <= 256 && /\p{L}/u.test(value) && !/[\s/?#\\]/u.test(value);
}

interface RuleIdentityValue { readonly slug: string; readonly transformations: readonly FavoriteIdentityTransformation[] }

function identityValue(segment: Extract<Segment, { kind: 'identity' }>, raw: string): RuleIdentityValue | undefined {
  const opaque = segment.prefix === 'opaque-5' ? /^([a-z0-9]{4,5})-(.+)$/u.exec(raw) : undefined;
  const withoutPrefix = opaque?.[2] ?? raw;
  if (segment.routingSuffixDigits === undefined) return { slug: withoutPrefix, transformations: [] };
  const match = /^(.+)[-_.](0\d{2})$/u.exec(withoutPrefix);
  const slug = match?.[1];
  if (slug === undefined) return { slug: withoutPrefix, transformations: [] };
  if (!/\p{L}/u.test(slug)) return undefined;
  return { slug, transformations: ['numeric-routing-suffix'] };
}

export function createFavoriteSiteAdapters(input: FavoriteSiteRules): readonly FavoriteSourceAdapter[] {
  const snapshot = favoriteSiteRulesSchema.parse(input);
  return [...new Set(snapshot.rules.map((rule) => rule.origin))].map((origin) => ({
    id: `site-rules-v${snapshot.version}:${origin}`, origins: [origin],
    analyze(source, url) {
      const applicable = snapshot.rules.filter((rule) => rule.origin === origin && rule.segments.length === url.decodedSegments.length
        && rule.segments.every((segment, index) => matches(segment, url.decodedSegments[index] ?? '')));
      const rule = applicable[0];
      if (applicable.length !== 1 || rule === undefined) return undefined;
      const rawSlug = url.decodedSegments[rule.identitySegment];
      if (rawSlug === undefined) return undefined;
      const identitySegment = rule.segments[rule.identitySegment];
      if (identitySegment?.kind !== 'identity') return undefined;
      const identity = identityValue(identitySegment, rawSlug);
      if (identity === undefined) return undefined;
      const slug = identity.slug;
      const title = slug.replace(/[-_.]+/gu, ' ').trim();
      const evidence: MutableSourceEvidence = {
        aliases: [{ provenance: 'stable-url-slug', value: title }], canonicalUrl: `${origin}/${url.rawSegments.slice(0, rule.identitySegment + 1).join('/')}`,
        diagnostics: [], identityTransformations: identity.transformations, key: source.sourceKey, mediaKind: rule.mediaKind, origin, path: url.pathname,
        proofs: ['CATEGORY_PATH', 'TITLE_SLUG'], rawSlug, sourceAdapter: `site-rules-v${snapshot.version}:${rule.id}`,
        stableSlug: slug, strategy: 'exact-origin', title,
      };
      if (rule.seasonSegment !== undefined) {
        const segment = rule.segments[rule.seasonSegment];
        if (segment?.kind === 'number') {
          const season = numberValue(segment, url.decodedSegments[rule.seasonSegment] ?? '');
          if (season !== undefined) evidence.season = season;
        }
      }
      if (rule.release !== undefined) {
        const segment = rule.segments[rule.release.segment];
        const raw = url.decodedSegments[rule.release.segment] ?? '';
        if (segment?.kind === 'number') {
          const value = numberValue(segment, raw);
          if (value !== undefined) evidence.release = { kind: rule.release.kind, provenance: 'URL_PATH', raw, value };
        }
      }
      return createSourceEvidence(evidence);
    },
  }));
}

const catalogue = { kind: 'literal', values: ['catalogue'] } as const;
const identity = { kind: 'identity' } as const;
const language = { kind: 'literal', values: ['vf', 'vostfr', 'vo'] } as const;
export const bundledFavoriteSiteRules: FavoriteSiteRules = favoriteSiteRulesSchema.parse({
  schemaVersion: 1, version: 3,
  rules: [...['https://anime-sama.fr', 'https://anime-sama.si'].flatMap((origin, index) => [
    { id: `anime-sama-${index}-identity`, identitySegment: 1, mediaKind: 'UNKNOWN', origin, segments: [catalogue, identity] },
    ...[false, true].flatMap((withLanguage) => [
      { id: `anime-sama-${index}-anime-${withLanguage}`, identitySegment: 1, mediaKind: 'ANIME', origin, seasonSegment: 2, segments: [catalogue, identity, { kind: 'number', maximum: 99, prefix: 'saison' }, ...(withLanguage ? [language] : [])] },
      { id: `anime-sama-${index}-scan-${withLanguage}`, identitySegment: 1, mediaKind: 'MANGA', origin, segments: [catalogue, identity, { kind: 'literal', values: ['scan', 'scans'] }, ...(withLanguage ? [language] : [])] },
    ]),
  ]),
  ...[false, true].map((withChapter) => {
    const rule = {
      id: `comix-title-${withChapter}`, origin: 'https://comix.to', identitySegment: 1, mediaKind: 'MANGA',
      segments: [{ kind: 'literal', values: ['title'] }, { kind: 'identity', prefix: 'opaque-5' }, ...(withChapter ? [{ kind: 'number', format: 'id-chapter', maximum: 100_000 }] : [])],
    };
    return withChapter ? { ...rule, release: { kind: 'chapter', segment: 2 } } : rule;
  }),
  ...['https://manhwaz.com', 'https://www.manhwaz.com'].flatMap((origin, originIndex) => [false, true].map((withChapter) => {
    const rule = {
      id: `manhwaz-webtoon-${originIndex}-${withChapter}`, origin, identitySegment: 1, mediaKind: 'MANHWA',
      segments: [{ kind: 'literal', values: ['webtoon'] }, { kind: 'identity', routingSuffixDigits: 3 }, ...(withChapter ? [{ kind: 'number', maximum: 100_000, prefix: 'chapter-' }] : [])],
    };
    return withChapter ? { ...rule, release: { kind: 'chapter', segment: 2 } } : rule;
  }))],
});
