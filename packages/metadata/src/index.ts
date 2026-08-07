import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { safeRequest } from "@favlib/safe-http";
import { FAVORITE_PROGRESS_PARSER_VERSION as sharedFavoriteProgressParserVersion, parseBookmarkTitle as sharedParseBookmarkTitle, progressionFromFavorite as sharedProgressionFromFavorite } from '@favlib/metadata/bookmark-parser';
export type { FavoriteProgression } from '@favlib/metadata/bookmark-parser';

export type SearchClient = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
export type MediaType = "ANIME" | "MANGA" | "MANHWA" | "MANHUA";
export type SourceIdentity = {
  key: string;
  title: string;
  slug?: string;
  releaseSuffix?: string;
  canonicalUrl: string;
  type: MediaType;
  strategy: "adapter" | "generic";
  evidence: string[];
};
export type SourceDisposition = {
  status: "review" | "excluded";
  reason: string;
};
export type PageMetadata = {
  title?: string;
  image?: string;
  canonicalUrl: string;
  type?: string;
  year?: number;
  format?: string;
  provider: "source-page";
  confidence: number;
};
type AniListDate = { year?: number; month?: number; day?: number };
export type AniListTitle = {
  romaji?: string;
  english?: string;
  native?: string;
  userPreferred?: string;
};
type AniListRelation = {
  id: number;
  relationType?: string;
  type?: "ANIME" | "MANGA";
  title?: AniListTitle;
  format?: string;
};
type AniListTag = {
  id?: number;
  name: string;
  description?: string;
  rank?: number;
  isMediaSpoiler?: boolean;
  isGeneralSpoiler?: boolean;
  isAdult?: boolean;
  category?: string;
};
type AniListStudio = {
  id?: number;
  name: string;
  isMain?: boolean;
  isAnimationStudio?: boolean;
  siteUrl?: string;
};
type AniListAiring = {
  airingAt?: number;
  episode?: number;
  timeUntilAiring?: number;
};
export type AniListMedia = {
  id: number;
  idMal?: number;
  type: "ANIME" | "MANGA";
  format?: string;
  status?: string;
  startDate?: AniListDate;
  endDate?: AniListDate;
  startYear?: number;
  seasonInt?: number;
  countryOfOrigin?: string;
  genres: string[];
  tags: AniListTag[];
  description?: string;
  coverImage?: string;
  bannerImage?: string;
  color?: string;
  siteUrl?: string;
  title: AniListTitle;
  synonyms: string[];
  season?: string;
  seasonYear?: number;
  episodes?: number;
  chapters?: number;
  volumes?: number;
  duration?: number;
  averageScore?: number;
  meanScore?: number;
  popularity?: number;
  trending?: number;
  favourites?: number;
  isAdult?: boolean;
  isLicensed?: boolean;
  isLocked?: boolean;
  source?: string;
  hashtag?: string;
  updatedAt?: number;
  nextAiringEpisode?: AniListAiring;
  airingSchedule: AniListAiring[];
  externalLinks?: { site?: string; url?: string }[];
  relations: AniListRelation[];
  streamingEpisodes: {
    title?: string;
    thumbnail?: string;
    url?: string;
    site?: string;
  }[];
  studios: AniListStudio[];
  authors: string[];
};
export type AniListMatch = {
  media: AniListMedia;
  displayTitle: string;
  titles: string[];
  score?: number;
};
export type AniListCandidateScore = {
  media: AniListMedia;
  score: number;
  matchedAlias?: string;
  matchedTitle?: string;
  reason: "NORMALIZED_EXACT" | "COMPACT_EXACT" | "PARTIAL" | "TOKEN_OVERLAP" | "NO_MATCH";
};
export type AniListHooks = {
  beforeRequest?: () => Promise<undefined | (() => Promise<void>)>;
  onRateLimit?: (retryAt: number) => Promise<void>;
};
const UA =
  "FavLib/1.0 (private local media tracker; favlib.home.arpa)";
const HTML_MAX = 512 * 1024,
  JSON_MAX = 2 * 1024 * 1024;

function safeFetch(
  maxBytes: number,
  mimeTypes: readonly string[],
): SearchClient {
  return async (input, init = {}) => {
    const r = await safeRequest(new URL(input as string | URL), {
      method: (init.method ?? "GET") as any,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
      body: typeof init.body === "string" ? init.body : undefined,
      timeoutMs: 8000,
      maxBytes,
      mimeTypes,
      maxRedirects: 2,
    });
    return new Response(r.body, {
      status: r.status,
      headers: r.headers as HeadersInit,
    });
  };
}
function decode(v: string) {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}
function slugTitle(v: string) {
  return decode(v)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}
export function compactTitleKey(v: string) {
  return normalizeTitle(v).replace(/\s+/g, "");
}
export function normalizeTitle(v: string) {
  return v
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export const COLLECTIVE_TITLE_KEY_VERSION = 1;

export function requiredProviderForMediaType(mediaType: MediaType): "anilist" | "mangaupdates" {
  return mediaType === "ANIME" ? "anilist" : "mangaupdates";
}

export function assertProviderMediaType(input: {provider:"anilist"|"mangaupdates";mediaType:MediaType}) {
  const required = requiredProviderForMediaType(input.mediaType);
  if (input.provider !== required) throw new Error("PROVIDER_MEDIA_TYPE_MISMATCH");
  return input;
}

/** Stable, provider-symmetric key for sharing review evidence. Raw input and
 * season provenance remain stored by callers; a trailing number alone is not
 * promoted to season evidence here. */
export function collectiveTitleKey(input: {
  provider: "anilist" | "mangaupdates";
  mediaType: MediaType;
  parsedTitle: string;
  explicitSeason?: number | null;
}) {
  assertProviderMediaType(input);
  const title = normalizeTitle(input.parsedTitle);
  if (!title) throw new Error("COLLECTIVE_TITLE_EMPTY");
  const season = input.provider === "anilist" && Number.isInteger(input.explicitSeason) && Number(input.explicitSeason) > 0
    ? `:season-${Number(input.explicitSeason)}` : "";
  return `v${COLLECTIVE_TITLE_KEY_VERSION}:${input.provider}:${input.mediaType}:${title}${season}`;
}

/** Parse only public provider identity URLs. AniList identifiers are numeric;
 * MangaUpdates identifiers are opaque ASCII tokens. */
export function providerIdFromUrl(provider: "anilist" | "mangaupdates", value: string) {
  let url: URL;
  try { url = new URL(value); } catch { return null; }
  if (!/^https?:$/u.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./u, "");
  if (provider === "anilist") {
    if (host !== "anilist.co") return null;
    return url.pathname.match(/^\/(?:anime|manga)\/(\d+)(?:\/|$)/u)?.[1] ?? null;
  }
  if (host !== "mangaupdates.com") return null;
  return url.pathname.match(/^\/series\/([A-Za-z0-9]+)(?:\/[^/]*)?\/?$/u)?.[1] ?? null;
}

const PRE_SERIALIZATION = /\bpre[\s-]*seriali[sz](?:ation|ed)\b/iu;
export function hasPreSerializationMarker(value: string) {
  return PRE_SERIALIZATION.test(normalizeTitle(value));
}
export function preSerializationCandidateAllowed(sourceEvidence: string[], candidateTitles: string[]) {
  const sourceRequiresIt = sourceEvidence.some(hasPreSerializationMarker);
  const candidateHasIt = candidateTitles.some(hasPreSerializationMarker);
  return sourceRequiresIt ? candidateHasIt : !candidateHasIt;
}

export function hasExplicitOvaMarker(value: string) {
  return /(?:^|[^\p{L}\p{N}])ova(?:$|[^\p{L}\p{N}])/iu.test(value.normalize('NFKC'));
}
export function aniListFormatAllowed(sourceEvidence: string[], format: string | undefined) {
  const requiresOva = sourceEvidence.some(hasExplicitOvaMarker);
  return requiresOva ? format?.toUpperCase() === 'OVA' : format?.toUpperCase() !== 'OVA';
}

export type LibraryStatus = 'Ongoing' | 'Hiatus' | 'Completed' | 'Cancelled';
export function canonicalLibraryStatus(value: unknown): LibraryStatus {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  if (/\b(?:on\s+)?hiatus\b/iu.test(text)) return 'Hiatus';
  if (/\b(?:complete|completed|finished)\b/iu.test(text)) return 'Completed';
  if (/\b(?:cancelled|canceled)\b/iu.test(text)) return 'Cancelled';
  if (/\b(?:discontinued|dropped)\b/iu.test(text)) return 'Cancelled';
  if (/\b(?:ongoing|releasing)\b/iu.test(text)) return 'Ongoing';
  if (/\b(?:not[_ -]?yet[_ -]?released|upcoming|planned)\b/iu.test(text)) return 'Ongoing';
  return 'Ongoing';
}

/** Match an alias against a provider title, including only a final
 * parenthesized suffix (for example `Existence (Wangho)`). */
export function exactTitleMatchKind(alias: string, title: string):
  | "NORMALIZED_EXACT"
  | "COMPACT_EXACT"
  | "SUBTITLE_EXACT"
  | "ALIAS_PARENTHESIZED_EXACT"
  | "PARENTHESIZED_EXACT"
  | undefined {
  const normalizedAlias = normalizeTitle(alias);
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedAlias || !normalizedTitle) return undefined;
  if (normalizedTitle === normalizedAlias) return "NORMALIZED_EXACT";
  if (compactTitleKey(title) === compactTitleKey(alias)) return "COMPACT_EXACT";
  if (seasonTitleKey(normalizedAlias) === seasonTitleKey(normalizedTitle) &&
      seasonTitleKey(normalizedAlias) !== normalizedAlias)
    return "COMPACT_EXACT";
  const subtitle = title.match(/^([^:：]+)[:：]\s*(\S.*)$/u);
  const exactSegment = [subtitle?.[1], subtitle?.[2]].filter((segment): segment is string => Boolean(segment?.trim())).some(segment =>
    normalizeTitle(segment) === normalizedAlias || compactTitleKey(segment) === compactTitleKey(alias));
  if (exactSegment)
    return "SUBTITLE_EXACT";
  const aliasBase = alias.replace(/\s*\([^()]*\)\s*$/u, "").trim();
  if (aliasBase !== alias && (normalizeTitle(aliasBase) === normalizedTitle || compactTitleKey(aliasBase) === compactTitleKey(title)))
    return "ALIAS_PARENTHESIZED_EXACT";
  const base = title.replace(/\s*\([^()]*\)\s*$/u, "").trim();
  if (base !== title && normalizeTitle(base) === normalizedAlias)
    return "PARENTHESIZED_EXACT";
  if (base !== title && compactTitleKey(base) === compactTitleKey(alias))
    return "PARENTHESIZED_EXACT";
  return undefined;
}

const ROMAN_SEASONS = new Map([
  ["i", "1"], ["ii", "2"], ["iii", "3"], ["iv", "4"], ["v", "5"],
  ["vi", "6"], ["vii", "7"], ["viii", "8"], ["ix", "9"], ["x", "10"],
]);

/** Normalize only an explicit final season marker. Numbers elsewhere remain
 * identity-bearing title text and are never rewritten. */
function seasonTitleKey(value: string) {
  const match = value.match(/^(.*?)(?:\s+(?:season|saison))?\s+(\d{1,2}|i{1,3}|iv|v|vi{0,3}|ix|x)(?:\s+(?:season|saison))?$/u);
  if (!match?.[1] || !match[2]) return value;
  const season = ROMAN_SEASONS.get(match[2]) ?? match[2];
  return `${match[1].trim()} season ${season}`;
}

export function titleCandidateFromBookmark(v: string) {
  let s = v.replace(/\s+/g, " ").trim();
  s = s.replace(/\s*(?:\(\s*)?(?:18|19|20|21)\d{2}(?:\s*\))?\s*$/u, "").trim();
  s = stripCatalogMarketingSuffix(s);
  // A separator is explicit release-position provenance. A bare number without
  // that provenance remains identity-bearing and is deliberately preserved.
  s = s.replace(/\s+[-–—|:]\s*#?\d+(?:\.\d+)?(?:\s+(?:vostfr|vf|vo|sub|dub|scan|scans))?\s*$/iu, "").trim();
  const leadingRelease = s.match(/^(?:chapter|chapitre|chap|ch\.?|episode|épisode|ep\.?)\s*#?\d[\d.\-a-z]*(?:\s*\([^)]*\))?\s*[-–—|:]\s*(.+?)(?:\s*\|\s*[^|]+)?$/iu);
  if (leadingRelease?.[1]) s = leadingRelease[1].trim();
  s = s.replace(/^(?:read|watch|lire|regarder)\s+/i, "");
  s = s.replace(
    /\s+(?:[-–—·:|]\s*)?(?:chapter|chapitre|chap|ch\.?|episode|épisode|ep\.?|volume|vol\.?|season|saison)\s*#?\d[\d.\-a-z]*.*$/iu,
    "",
  );
  s = s.replace(/\s*\|\s*[^|]+$/u, "");
  s = s.replace(
    /\s+[-–—·]\s+(?:read|watch|lire|english|français|vostfr|vf|scan|scans|manga|manhwa|manhua|webtoon)\b.*$/iu,
    "",
  );
  s = s.replace(/[\s|·:—–-]+$/u, "").trim();
  s = stripCatalogMarketingSuffix(s);
  return s.length >= 2 ? s : undefined;
}

/** Title used for cards and headings. Input titles remain untouched in the
 * provenance tables; this function is deliberately display-only. */
export function cleanDisplayTitle(v: string) {
  let s = stripCatalogMarketingSuffix(v.replace(/\s+/gu, " ").trim());
  if (!s) return undefined;
  const release = /(?:^|\s*(?:[-–—|·:]\s*|\s+))(?:(?:episode|ep\.?|chapter|chapitre|chap\.?|ch\.?|volume|vol\.?|season|saison)\s*#?\d+[\w.-]*).*/iu;
  const separatedRelease = /(?:^|\s*(?:[-–—|·:]\s*))(?:\d+\s*(?:vostfr|vf|vo|sub|dub|scan|scans)?|(?:vostfr|vf|vo|sub|dub|scan|scans)(?:\s*[- ]?\d+|\s*$)).*/iu;
  const site = /(?:^|\s*(?:[-–—|·:]\s*|\s+))(?:voiranime|mangakakalot|anime[- ]?sama|japscan|lelscan|manganato|mangadex)(?:\b.*)?$/iu;
  for (let pass = 0; pass < 5; pass++) {
    const before = s;
    s = s.replace(release, "").replace(separatedRelease, "").replace(site, "").replace(/[|·:—–-]+$/gu, "").trim();
    if (s === before) break;
  }
  const key = (text: string) => normalizeTitle(text).replace(/[^\p{L}\p{N}]+/gu, "");
  const kept: string[] = [];
  for (const part of s.split(/\s*(?:\||·|—|–)\s*|\s+-\s+/u).map((x) => x.trim()).filter(Boolean)) {
    if (!kept.some((item) => key(item) === key(part))) kept.push(part);
  }
  s = kept.join(" - ").trim();
  return s.length >= 2 && !/^(?:episode|chapter|volume|vostfr|vf|scan)\b/iu.test(s) ? s : undefined;
}

/** Shared bookmark-title parser for extension ingestion and resolver hints. */
export function parseBookmarkTitle(value: string) {
  return sharedParseBookmarkTitle(value);
}
export const progressionFromFavorite = sharedProgressionFromFavorite;
export const FAVORITE_PROGRESS_PARSER_VERSION = sharedFavoriteProgressParserVersion;

function stripCatalogMarketingSuffix(value: string) {
  const releaseBadge = String.raw`(?:\[|\()\s*(?:new|nouveaux?|nouvelles?)\s+(?:chapters?|chapitres?|episodes?|épisodes?|volumes?|releases?|sorties?)\s*(?:\]|\))`;
  const catalogPrefix = String.raw`(?:(?:manga|manhwa|manhua|webtoon)\s+)?(?:english|français|french|vostfr|vf)\s+`;
  const promotion = String.raw`(?:\s+(?:online\s+free|free\s+online|read\s+online(?:\s+free)?|lire\s+en\s+ligne(?:\s+gratuitement)?))?`;
  return value.replace(new RegExp(String.raw`\s+(?:${catalogPrefix})?${releaseBadge}${promotion}\s*$`, "iu"), "").trim();
}

const RELEASE_WORDS = /^(?:vf|vostfr|vo|sub|dub|scan|scans|english|français|french)$/iu;
const RELEASE_PREFIX = /^(?:(?:episode|ep|chapter|chapitre|chap|ch|volume|vol|season|saison)[-_ .]*\d+|\d+[-_ .]*(?:vostfr|vf|vo|sub|dub|scan|scans|english|français)?|(?:vf|vostfr|vo|sub|dub|scan|scans|english|français)[-_ .]*\d+)$/iu;
function pathReleaseSegment(value: string) {
  return RELEASE_WORDS.test(value) || RELEASE_PREFIX.test(value) || /^(?:saison|season)[-_ .]*\d+$/iu.test(value);
}
function cleanUrlTitle(value: string, parts: string[]) {
  let s = slugTitle(value);
  // A numeric/release tail is removable only because the path supplied the
  // corresponding release evidence. Words inside the slug remain intact.
  s = s.replace(/(?:[-_ .]+)(?:(?:episode|ep|chapter|chapitre|chap|ch|volume|vol)[-_ .]*\d+|\d+[-_ .]*(?:vostfr|vf|vo|sub|dub|scan|scans|english|français)?)$/iu, "");
  s = s.replace(/\s+\d{4,}$/u, "").trim();
  return s.length >= 2 && !/^\d+$/u.test(s) && !parts.some((part) => compactTitleKey(part) === compactTitleKey(s) && pathReleaseSegment(part)) ? s : undefined;
}

export type TitlePreparation = {
  original: string;
  personal?: string;
  year?: number;
  urlTitle?: string;
  sourceTitle?: string;
  candidates: string[];
  transformations: string[];
};

/** Shared, provenance-friendly title preparation for both metadata providers. */
export function prepareTitleCandidates(input: {
  bookmarkTitle: string;
  url: string;
  source?: SourceIdentity | null;
}): TitlePreparation {
  const source = input.source ?? sourceIdentityFromUrl(input.url);
  const original = input.bookmarkTitle;
  let personal = input.bookmarkTitle.replace(/\s+/g, " ").trim();
  const transformations: string[] = [];
  const yearMatch = personal.match(/(?:^|\s)(?:\(\s*)?((?:18|19|20|21)\d{2})(?:\s*\))?\s*$/u);
  const year = yearMatch ? Number(yearMatch[1]) : undefined;
  if (year !== undefined) transformations.push("extracted_bookmark_year");
  if (/^(?:watch(?:\s+full)?|read|lire|regarder)\s+/iu.test(personal)) {
    personal = personal.replace(/^(?:watch(?:\s+full)?|read|lire|regarder)\s+/iu, "");
    transformations.push("removed_action_prefix");
  }
  try {
    const host = new URL(input.url).hostname.replace(/^www\./iu, "");
    const hostName = host.split(".")[0].replace(/[-_]+/g, " ");
    const before = personal;
    personal = personal.replace(new RegExp(`(?:^|\\s|[|·—–-])${hostName.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}(?:\\s|$|[|·—–-])`, "iu"), " ").replace(/\s+/g, " ").trim();
    if (personal !== before) transformations.push("removed_site_name");
  } catch { /* sourceIdentity already handles malformed URLs */ }
  const cleaned = titleCandidateFromBookmark(personal);
  if (cleaned && cleaned !== personal) {
    personal = cleaned;
    transformations.push("removed_bookmark_release_suffix");
  }
  const urlTitle = source?.title;
  if (urlTitle && /(?:^|\/)(?:saison|season)\d*(?:\/|$)/iu.test(new URL(input.url).pathname)) {
    const withoutEpisode = personal.replace(/\s+\d+$/u, "").replace(/\d+$/u, "");
    if (withoutEpisode && compactTitleKey(urlTitle).includes(compactTitleKey(withoutEpisode))) {
      personal = withoutEpisode.trim();
      personal = personal.replace(/[\s|·:—–-]+$/u, "").trim();
      transformations.push("removed_season_episode_number");
    }
  }
  if (urlTitle && personal) {
    const matchingPart = personal
      .split(/\s*(?:\||·|—|–)\s*|\s+-\s+/u)
      .map((part) => part.trim())
      .find((part) => compactTitleKey(part) === compactTitleKey(urlTitle));
    if (matchingPart && matchingPart !== personal) {
      personal = matchingPart;
      transformations.push("selected_url_matching_personal_part");
    }
  }
  if (urlTitle && personal && compactTitleKey(personal) === compactTitleKey(urlTitle) && personal !== urlTitle)
    transformations.push("preserved_personal_punctuation");
  const sameBase = Boolean(personal && urlTitle && compactTitleKey(personal) === compactTitleKey(urlTitle));
  // The URL parser owns identity. A matching favorite may only restore useful
  // punctuation/case; otherwise it is a fallback after the URL candidate.
  const values = (sameBase ? [personal, urlTitle, source?.title, original] : [urlTitle, source?.title, personal, original])
    .filter((v): v is string => Boolean(v?.trim()));
  const candidates = [...new Set(values.flatMap((value) => [value.trim(), normalizeTitle(value), compactTitleKey(value)]).filter((value) => value.length > 1))];
  return { original, personal: personal || undefined, year, urlTitle, sourceTitle: source?.title, candidates, transformations };
}

export function sourceIdentityFromUrl(value: string): SourceIdentity | null {
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol) || /^\/catalogue\/?$/i.test(u.pathname))
    return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const parts = u.pathname.split("/").filter(Boolean).map(decode);
  const blocked = new Set([
    "search",
    "login",
    "account",
    "settings",
    "genre",
    "genres",
    "tag",
    "tags",
    "titles",
    "manga",
    "anime",
    "series",
    "read",
    "watch",
    "chapter",
    "chapitre",
    "episode",
    "home",
    "en",
    "fr",
    "ja",
    "ko",
    "english",
    "français",
    "vf",
    "vostfr",
    "vo",
    "sub",
    "dub",
    "scan",
    "scans",
  ]);
  const pathText = parts.join(" ").toLowerCase();
  const unsupportedDrama = /(?:^|\s)drama(?:\s|$)/iu.test(pathText) && !/(?:^|\s)(?:anime|manga|scan|scans|manhwa|manhua|webtoon)(?:\s|$)/iu.test(pathText);
  if (unsupportedDrama) return null;
  const typeFrom = (s: string): MediaType =>
    /(?:^|\s)(?:manhwa|webtoon)(?:\s|$)/i.test(s)
      ? "MANHWA"
      : /(?:^|\s)manhua(?:\s|$)/i.test(s)
        ? "MANHUA"
        : /(?:^|\s)(?:scan|scans|manga)(?:\s|$)/i.test(s)
          ? "MANGA"
          : /(?:^|\s)(?:anime|episode|season|saison)(?:\s|$)/i.test(s)
          ? "ANIME"
          : "MANGA";
  let index = parts.findIndex((p) =>
    /^(catalogue|title|anime|manga|manhwa|manhua|webtoon|series|read|comic|saison\d*|season\d*)$/i.test(
      p,
    ),
  );
  const pathType = /(?:^|\/)(?:manhwa|webtoon)(?:\/|$)/i.test(`/${parts.join("/")}`)
    ? "MANHWA" : /(?:^|\/)(?:manhua)(?:\/|$)/i.test(`/${parts.join("/")}`)
      ? "MANHUA" : /(?:^|\/)(?:scan|scans|manga)(?:\/|$)/i.test(`/${parts.join("/")}`)
        ? "MANGA" : /(?:^|\/)(?:anime|episode|season|saison)(?:\/|$)/i.test(`/${parts.join("/")}`)
          ? "ANIME" : /(?:^|\/)(?:saison|season)\d*(?:\/|$)/i.test(`/${parts.join("/")}`)
            ? "ANIME" : undefined;
  let slug = index >= 0 ? parts[index + 1] : undefined;
  let titleSegment = slug;
  let evidence = index >= 0 ? ["CATEGORY_PATH"] : [];
  // Sites commonly put a stable identity slug before a more human, punctuated
  // release slug (e.g. /anime/remonster/re-monster-02-vostfr).
  if (index >= 0 && parts[index + 2] && !blocked.has(parts[index + 2].toLowerCase()) && !pathReleaseSegment(parts[index + 2]) && !/(?:chapter|chapitre|episode|volume|season|saison)[-_ .]*\d/iu.test(parts[index + 2]) && !/^(?:chapter|chapitre|chap|ch|episode|ep|volume|vol|season|saison)$/iu.test(parts[index + 2]) && cleanUrlTitle(parts[index + 2], parts)) {
    titleSegment = parts[index + 2];
    evidence.push("TITLE_SLUG");
  }
  if (!slug) {
    for (let i = parts.length - 1; i >= 0; i--) {
      const m = parts[i].match(
        /^(.*?)[-_.](?:chapter|chapitre|chap|ch|episode|ep|volume|vol)[-_.]?\d+/i,
      );
      if (m?.[1] && !blocked.has(m[1].toLowerCase())) {
        slug = m[1];
        index = i;
        evidence = ["RELEASE_SUFFIX"];
        break;
      }
      if (
        /^(?:chapter|chapitre|chap|ch|episode|ep|volume|vol)[-_.]?\d+/i.test(
          parts[i],
        ) &&
        i > 0 &&
        !blocked.has(parts[i - 1].toLowerCase())
      ) {
        slug = parts[i - 1];
        index = i - 1;
        evidence = ["RELEASE_PATH"];
        break;
      }
      if (/^(?:vf|vostfr|vo|sub|dub|scan|scans)[-_ .]+\d+$/iu.test(parts[i]) && i > 0) {
        slug = parts[i - 1];
        index = i - 1;
        evidence = ["RELEASE_PATH"];
        break;
      }
    }
  }
  if (!slug || blocked.has(slug.toLowerCase()) || /^\d+$/.test(slug))
    return null;
  // ComicK reserves a leading numeric component on /comic/ slugs for routing.
  // This rule is deliberately host/path scoped so title-bearing numbers on all
  // other URL structures remain identity evidence.
  if (/^comick\.(?:dev|io|to)$/iu.test(host) && parts[index]?.toLowerCase() === 'comic') {
    const technical = slug.match(/^\d+-+(.+)$/u);
    if (technical?.[1]) {
      slug = technical[1];
      if (titleSegment === parts[index + 1]) titleSegment = slug;
      evidence.push('COMICK_TECHNICAL_PREFIX_REMOVED');
    }
  }
  slug = slug
    .replace(
      /^(?=[a-z0-9]{3,8}-)(?=[a-z0-9]*[a-z])(?=[a-z0-9]*\d)[a-z0-9]+-/i,
      "",
    )
    .replace(
      /[-_.](?:chapter|chapitre|chap|ch|episode|ep|volume|vol)[-_.]?\d.*$/i,
      "",
    );
  const title = cleanUrlTitle(titleSegment === parts[index + 1] ? slug : titleSegment ?? slug, parts) ?? titleCandidateFromBookmark(slugTitle(slug))
    ?.replace(/\s+\d{4,}$/, "")
    .trim();
  if (!title || title.length < 2) return null;
  const rawTitle = titleSegment ?? slug;
  const embeddedRelease = rawTitle?.match(/(?:^|[-_ .])((?:episode|ep|chapter|chapitre|chap|ch|volume|vol|season|saison)[-_ .]*\d+|\d+[-_ .]*(?:vostfr|vf|vo|sub|dub|scan|scans|english|français))/iu)?.[1];
  const pathRelease = parts.slice(Math.max(0, index + 1)).filter((part) => pathReleaseSegment(part)).join("/");
  const stable = host.replace(/^v\d+\./, "");
  return {
    key: `${stable}:${normalizeTitle(slug).replace(/ /g, "-")}`,
    title,
    slug,
    releaseSuffix: (embeddedRelease ?? pathRelease) || undefined,
    canonicalUrl: `https://${host}/${parts.slice(0, index + 2).join("/")}`,
    type: pathType ?? typeFrom(pathText),
    strategy: evidence.length ? "adapter" : "generic",
    evidence,
  };
}
export function sourceDispositionFromUrl(v: string): SourceDisposition {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return { status: "excluded", reason: "INVALID_URL" };
  }
  if (!/^https?:$/.test(u.protocol))
    return { status: "excluded", reason: "NON_WEB_URL" };
  const p = u.pathname
    .split("/")
    .filter(Boolean)
    .map((x) => x.toLowerCase());
  if (
    (p.length === 1 && p[0] === "catalogue") ||
    (p.length === 2 && p[0] === "catalogue" && p[1] === "index.php")
  )
    return { status: "excluded", reason: "UTILITY_PAGE" };
  if (!p.length) return { status: "excluded", reason: "ROOT_PAGE" };
  if (
    p.some((x) =>
      /^(search|login|account|settings|genre|genres|tag|tags)$/.test(x),
    )
  )
    return { status: "excluded", reason: "UTILITY_PAGE" };
  return { status: "review", reason: "URL_IDENTITY_UNRESOLVED" };
}
export function sameSiteUrl(a: string, b: string) {
  try {
    const x = new URL(a).hostname.replace(/^www\./, "").toLowerCase(),
      y = new URL(b).hostname.replace(/^www\./, "").toLowerCase();
    return x === y || x.endsWith(`.${y}`) || y.endsWith(`.${x}`);
  } catch {
    return false;
  }
}

function attr(tag: string, name: string) {
  return tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
}
function absolute(v: string | undefined, b: string) {
  if (!v) return undefined;
  try {
    return new URL(v, b).toString();
  } catch {
    return undefined;
  }
}
export function extractPageMetadata(html: string, url: string): PageMetadata {
  if (new TextEncoder().encode(html).byteLength > HTML_MAX)
    throw new Error("METADATA_HTML_TOO_LARGE");
  const metas = [...html.matchAll(/<meta\b[^>]*>/gi)].map((x) => x[0]);
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((x) => x[0]);
  const meta = (...names: string[]) => {
    for (const n of names) {
      const t = metas.find((x) =>
        [attr(x, "property"), attr(x, "name")].some(
          (y) => y?.toLowerCase() === n,
        ),
      );
      const c = t && attr(t, "content");
      if (c) return c;
    }
  };
  const canonicalTag = links.find((x) =>
    /canonical/i.test(attr(x, "rel") ?? ""),
  );
  const canonical =
    absolute(canonicalTag && attr(canonicalTag, "href"), url) ??
    new URL(url).toString();
  let json: any = {};
  for (const m of html.matchAll(
    /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const x = JSON.parse(m[1]);
      json = Array.isArray(x) ? x[0] : x;
      break;
    } catch {}
  }
  const title = [
    json?.name,
    meta("og:title", "twitter:title"),
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1],
  ]
    .find(Boolean)
    ?.trim();
  const image = absolute(
    json?.image?.url ?? json?.image ?? meta("og:image", "twitter:image"),
    canonical,
  );
  const year = Number(
    String(json?.datePublished ?? meta("release_date") ?? "").slice(0, 4),
  );
  return {
    title,
    image,
    canonicalUrl: canonical,
    type: json?.["@type"] ?? meta("og:type"),
    year: Number.isInteger(year) && year > 1800 ? year : undefined,
    provider: "source-page",
    confidence: title?.length ? 0.96 : 0.6,
  };
}
function suspiciousPageMetadata(v: Partial<PageMetadata>) {
  return !!v.title && /index of|spinzywheel|roulette/i.test(v.title);
}
export { suspiciousPageMetadata };
export async function fetchPageMetadata(
  value: string,
  options: {
    fetch?: SearchClient;
    lookup?: (host: string) => Promise<string[]>;
    timeoutMs?: number;
    maxBytes?: number;
    spacingMs?: number;
  } = {},
): Promise<PageMetadata> {
  const u = new URL(value);
  if (!/^https?:$/.test(u.protocol) || u.username || u.password)
    throw new Error("PAGE_URL_INVALID");
  const lookup =
    options.lookup ??
    (async (h) => (await dnsLookup(h, { all: true })).map((x) => x.address));
  const addresses = await lookup(u.hostname);
  if (
    addresses.some(
      (a) =>
        isIP(a) &&
        !/^((?!127|10\\.|192\\.168|169\\.254|172\\.(1[6-9]|2\\d|3[01])\\.).)*$/.test(
          a,
        ),
    )
  )
    throw new Error("PAGE_PRIVATE_IP");
  const client =
    options.fetch ??
    safeFetch(options.maxBytes ?? HTML_MAX, [
      "text/html",
      "application/xhtml+xml",
    ]);
  const r = await client(u, {
    headers: { accept: "text/html,application/xhtml+xml", "user-agent": UA },
    signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
  });
  if (!r.ok) throw new Error(`PAGE_HTTP_${r.status}`);
  const text = await r.text();
  const result = extractPageMetadata(text, u.toString());
  if (suspiciousPageMetadata(result))
    throw new Error("PAGE_CONTENT_SUSPICIOUS");
  return result;
}

const ANILIST_SPACING_MS = 2100;
let anilistNext = 0;
const cache = new Map<string, { items: AniListMedia[] }>();
async function boundedJson(r: Response) {
  const length = Number(r.headers.get("content-length") ?? 0);
  if (length > JSON_MAX) throw new Error("ANILIST_RESPONSE_TOO_LARGE");
  const text = await r.text();
  if (new TextEncoder().encode(text).byteLength > JSON_MAX)
    throw new Error("ANILIST_RESPONSE_TOO_LARGE");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("ANILIST_JSON_INVALID");
  }
}
function anilistRetryAt(headers: Headers) {
  const afterHeader = headers.get("retry-after");
  const after = afterHeader === null ? NaN : Number(afterHeader);
  if (Number.isFinite(after) && after >= 0) return Date.now() + after * 1000;
  const resetHeader = headers.get("x-ratelimit-reset");
  const reset = resetHeader === null ? NaN : Number(resetHeader);
  if (Number.isFinite(reset) && reset > 0)
    return reset > 1e12 ? reset : reset * 1000;
  return Date.now() + 60_000;
}
async function anilistRequest(
  body: unknown,
  options: {
    endpoint?: string;
    fetch?: SearchClient;
    timeoutMs?: number;
    hooks?: AniListHooks;
  } = {},
) {
  for (;;) {
    let slotRelease: (() => Promise<void>) | undefined;
    try {
      const wait = options.hooks?.beforeRequest ? 0 : anilistNext - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (!options.hooks?.beforeRequest)
        anilistNext = Date.now() + ANILIST_SPACING_MS;
      slotRelease = await options.hooks?.beforeRequest?.();
      const client = options.fetch ?? safeFetch(JSON_MAX, ["application/json"]);
      const r = await client(options.endpoint ?? "https://graphql.anilist.co", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": UA,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
      });
      const remainingHeader = r.headers.get("x-ratelimit-remaining");
      const remaining =
        remainingHeader === null ? NaN : Number(remainingHeader);
      if (r.status === 429 || remaining === 0) {
        const until = anilistRetryAt(r.headers);
        await options.hooks?.onRateLimit?.(until);
        if (r.status === 429) {
          await slotRelease?.();
          slotRelease = undefined;
          const delay = until - Date.now();
          if (delay > 0)
            await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }
      }
      if (!r.ok) throw new Error(`ANILIST_HTTP_${r.status}`);
      const json = await boundedJson(r);
      if (json.errors?.length) throw new Error("ANILIST_GRAPHQL_ERROR");
      return json.data;
    } finally {
      await slotRelease?.();
    }
  }
}
const fields = `id idMal type format status startDate{year month day} endDate{year month day} countryOfOrigin genres tags{id name description rank isMediaSpoiler isGeneralSpoiler isAdult category} description coverImage{extraLarge large medium color} bannerImage siteUrl title{romaji english native userPreferred} synonyms season seasonYear seasonInt episodes chapters volumes duration averageScore meanScore popularity trending favourites isAdult isLicensed isLocked source hashtag updatedAt nextAiringEpisode{episode airingAt timeUntilAiring} airingSchedule(notYetAired:true,perPage:50){nodes{airingAt episode timeUntilAiring}} externalLinks{site url} relations{edges{relationType node{id type format title{romaji english native userPreferred}}}} streamingEpisodes{title thumbnail url site} studios{edges{isMain node{id name isAnimationStudio siteUrl}}} staff{edges{role node{name{full}}}}`;
const searchFields = `id type format startDate{year} title{romaji english native userPreferred} synonyms coverImage{extraLarge large medium color}`;
function mapMedia(x: any): AniListMedia {
  return {
    id: Number(x.id),
    idMal: x.idMal,
    type: x.type,
    format: x.format,
    status: x.status,
    startDate: x.startDate,
    endDate: x.endDate,
    startYear: x.startDate?.year,
    seasonInt: x.seasonInt,
    countryOfOrigin: x.countryOfOrigin,
    genres: Array.isArray(x.genres)
      ? x.genres.filter((v: unknown): v is string => typeof v === "string")
      : [],
    tags: Array.isArray(x.tags)
      ? x.tags
          .filter((v: any) => typeof v?.name === "string")
          .map((v: any) => ({
            id: v.id,
            name: v.name,
            description: v.description,
            rank: v.rank,
            isMediaSpoiler: v.isMediaSpoiler,
            isGeneralSpoiler: v.isGeneralSpoiler,
            isAdult: v.isAdult,
            category: v.category,
          }))
      : [],
    description: typeof x.description === "string" ? x.description : undefined,
    coverImage:
      x.coverImage?.extraLarge ?? x.coverImage?.large ?? x.coverImage?.medium,
    bannerImage: x.bannerImage,
    color: x.coverImage?.color,
    siteUrl: x.siteUrl,
    title: x.title ?? {},
    synonyms: Array.isArray(x.synonyms)
      ? x.synonyms.filter((v: unknown): v is string => typeof v === "string")
      : [],
    season: x.season,
    seasonYear: x.seasonYear,
    episodes: x.episodes,
    chapters: x.chapters,
    volumes: x.volumes,
    duration: x.duration,
    averageScore: x.averageScore,
    meanScore: x.meanScore,
    popularity: x.popularity,
    trending: x.trending,
    favourites: x.favourites,
    isAdult: x.isAdult,
    isLicensed: x.isLicensed,
    isLocked: x.isLocked,
    source: x.source,
    hashtag: x.hashtag,
    updatedAt: x.updatedAt,
    nextAiringEpisode: x.nextAiringEpisode,
    airingSchedule: Array.isArray(x.airingSchedule?.nodes)
      ? x.airingSchedule.nodes
      : [],
    externalLinks: x.externalLinks ?? [],
    relations: Array.isArray(x.relations?.edges)
      ? x.relations.edges
          .filter((v: any) => v?.node?.id)
          .map((v: any) => ({
            id: Number(v.node.id),
            relationType: v.relationType,
            type: v.node.type,
            title: v.node.title,
            format: v.node.format,
          }))
      : [],
    streamingEpisodes: Array.isArray(x.streamingEpisodes)
      ? x.streamingEpisodes
      : [],
    studios: Array.isArray(x.studios?.edges)
      ? x.studios.edges
          .filter((v: any) => v?.node?.name)
          .map((v: any) => ({
            id: v.node.id,
            name: v.node.name,
            isMain: v.isMain,
            isAnimationStudio: v.node.isAnimationStudio,
            siteUrl: v.node.siteUrl,
          }))
      : [],
    authors: Array.isArray(x.staff?.edges)
      ? x.staff.edges
          .filter((edge: any) => typeof edge?.node?.name?.full === "string")
          .filter((edge: any) => /author|artist|original creator|story|draw|director|screenplay|writer|creator|character design/iu.test(String(edge.role ?? "")))
          .map((edge: any) => edge.node.name.full)
      : [],
  };
}
type AniListSearchOptions = {
  endpoint?: string;
  fetch?: SearchClient;
  timeoutMs?: number;
  hooks?: AniListHooks;
  now?: number;
  type?: "ANIME" | "MANGA";
  cache?: boolean;
  page?: number;
  perPage?: number;
};
type PendingSearch = {
  query: string;
  key: string;
  options: AniListSearchOptions;
  resolve: (items: AniListMedia[]) => void;
  reject: (error: unknown) => void;
};
const SEARCH_BATCH_SIZE = 5;
let pendingSearches: PendingSearch[] = [];
let searchBatchTimer: ReturnType<typeof setTimeout> | undefined;
async function flushSearchBatch() {
  searchBatchTimer = undefined;
  const batch = pendingSearches.splice(0, SEARCH_BATCH_SIZE);
  if (!batch.length) return;
  const unique = [...new Map(batch.map((item) => [item.key, item])).values()];
  const variables: Record<string, string> = {};
  const definitions = unique
    .map((item, index) => {
      variables[`s${index}`] = item.query.slice(0, 200);
      return `$s${index}:String!`;
    })
    .join(",");
  const selections = unique
    .map(
      (item, index) =>
        `p${index}:Page(page:${Math.max(1, item.options.page ?? 1)},perPage:${Math.min(50, Math.max(1, item.options.perPage ?? 10))}){media(search:$s${index},type:${item.options.type}){${searchFields}}}`,
    )
    .join("");
  try {
    const data = await anilistRequest(
      { query: `query(${definitions}){${selections}}`, variables },
      unique[0].options,
    );
    const results = new Map<string, AniListMedia[]>();
    for (const [index, item] of unique.entries()) {
      const items = (data?.[`p${index}`]?.media ?? []).map(mapMedia);
      results.set(item.key, items);
      if (item.options.cache !== false) cache.set(item.key, { items });
    }
    for (const item of batch) item.resolve(results.get(item.key) ?? []);
  } catch (error) {
    for (const item of batch) item.reject(error);
  }
  if (pendingSearches.length && !searchBatchTimer)
    searchBatchTimer = setTimeout(() => void flushSearchBatch(), 25);
}
export function searchAniList(
  query: string,
  options: AniListSearchOptions = {},
): Promise<AniListMedia[]> {
  const type = options.type ?? "ANIME",
    key = `${type}:${Math.max(1, options.page ?? 1)}:${Math.min(50, Math.max(1, options.perPage ?? 10))}:${normalizeTitle(query)}`,
    hit = options.cache === false ? undefined : cache.get(key);
  if (hit) return Promise.resolve(hit.items);
  return new Promise((resolve, reject) => {
    pendingSearches.push({
      query,
      key,
      options: { ...options, type },
      resolve,
      reject,
    });
    if (pendingSearches.length >= SEARCH_BATCH_SIZE) {
      if (searchBatchTimer) {
        clearTimeout(searchBatchTimer);
        searchBatchTimer = undefined;
      }
      void flushSearchBatch();
    } else if (!searchBatchTimer)
      searchBatchTimer = setTimeout(() => void flushSearchBatch(), 25);
  });
}
type AniListIdOptions = {
  endpoint?: string;
  fetch?: SearchClient;
  timeoutMs?: number;
  hooks?: AniListHooks;
  cache?: boolean;
};
const idCache = new Map<number, AniListMedia>();
type PendingId = {
  id: number;
  options: AniListIdOptions;
  resolve: (media: AniListMedia) => void;
  reject: (error: unknown) => void;
};
let pendingIds: PendingId[] = [];
let idBatchTimer: ReturnType<typeof setTimeout> | undefined;
async function flushIdBatch() {
  idBatchTimer = undefined;
  const batch = pendingIds.splice(0, 50);
  if (!batch.length) return;
  const unique = [...new Map(batch.map((item) => [item.id, item])).values()];
  try {
    const data = await anilistRequest(
      {
        query: `query($ids:[Int!]!){Page(perPage:50){media(id_in:$ids){${fields}}}}`,
        variables: { ids: unique.map((item) => item.id) },
      },
      unique[0].options,
    );
    const found = new Map<number, AniListMedia>();
    const allowCache = unique.every((item) => item.options.cache !== false);
    for (const raw of data?.Page?.media ?? []) {
      const media = mapMedia(raw);
      if (allowCache) idCache.set(media.id, media);
      found.set(media.id, media);
    }
    for (const item of batch) {
      const media = found.get(item.id);
      if (media) item.resolve(media);
      else item.reject(new Error("ANILIST_MEDIA_NOT_FOUND"));
    }
  } catch (error) {
    for (const item of batch) item.reject(error);
  }
  if (pendingIds.length && !idBatchTimer)
    idBatchTimer = setTimeout(() => void flushIdBatch(), 25);
}
export function fetchAniList(
  id: number,
  options: AniListIdOptions = {},
): Promise<AniListMedia> {
  if (!Number.isInteger(id) || id <= 0)
    return Promise.reject(new Error("ANILIST_ID_INVALID"));
  const cached = options.cache === false ? undefined : idCache.get(id);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    pendingIds.push({ id, options, resolve, reject });
    if (pendingIds.length >= 50) {
      if (idBatchTimer) {
        clearTimeout(idBatchTimer);
        idBatchTimer = undefined;
      }
      void flushIdBatch();
    } else if (!idBatchTimer)
      idBatchTimer = setTimeout(() => void flushIdBatch(), 25);
  });
}

export async function fetchAniListCalendar(
  fromUnix: number,
  toUnix: number,
  options: AniListIdOptions & { maxPages?: number } = {},
): Promise<AniListMedia[]> {
  if (!Number.isInteger(fromUnix) || !Number.isInteger(toUnix) || fromUnix >= toUnix)
    throw new Error("ANILIST_CALENDAR_RANGE_INVALID");
  const byId = new Map<number, AniListMedia>();
  const maxPages = Math.min(20, Math.max(1, options.maxPages ?? 10));
  for (let page = 1; page <= maxPages; page++) {
    const data = await anilistRequest({
      query: `query($page:Int!,$from:Int!,$to:Int!){Page(page:$page,perPage:50){pageInfo{hasNextPage}airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME){airingAt episode mediaId media{id type format status seasonYear episodes title{romaji english native userPreferred}synonyms coverImage{extraLarge large medium color}siteUrl}}}}`,
      variables: { page, from: fromUnix, to: toUnix },
    }, options);
    const schedules = data?.Page?.airingSchedules ?? [];
    for (const schedule of schedules) {
      if (!schedule?.media?.id || !schedule.airingAt || !schedule.episode) continue;
      const id = Number(schedule.media.id);
      const existing = byId.get(id) ?? mapMedia(schedule.media);
      existing.airingSchedule = [...existing.airingSchedule, { airingAt: schedule.airingAt, episode: schedule.episode }];
      byId.set(id, existing);
    }
    if (!data?.Page?.pageInfo?.hasNextPage) break;
  }
  return [...byId.values()];
}
function latinTitle(media: AniListMedia) {
  const values = [
    media.title.english,
    media.title.romaji,
    media.title.userPreferred,
    ...media.synonyms,
  ];
  return (
    values.find(
      (v) =>
        v && !/[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af\u0400-\u04ff]/u.test(v),
    ) ??
    values.find(Boolean) ??
    `AniList ${media.id}`
  );
}
export function matchAniList(
  query: { aliases: string[]; type?: string; year?: number; format?: string },
  items: AniListMedia[],
): AniListMatch | null {
  const typed =
    query.type && query.type !== "UNKNOWN"
      ? items.filter(
          (x) => x.type === ("ANIME" === query.type ? "ANIME" : "MANGA"),
        )
      : items;
  // The same identity is commonly returned by several queries/pages. It must
  // not compete against itself in the ambiguity margin.
  const allowed = [...new Map(typed.map((item) => [item.id, item] as const)).values()];
  const score = (media: AniListMedia): AniListCandidateScore => {
    const names = [
      media.title.userPreferred,
      media.title.english,
      media.title.romaji,
      media.title.native,
      ...media.synonyms,
    ].filter((value): value is string => Boolean(value));
    let best: AniListCandidateScore = { media, score: 0, reason: "NO_MATCH" };
    for (const alias of query.aliases) {
      const normalizedAlias = normalizeTitle(alias);
      const compactAlias = compactTitleKey(alias);
      for (const name of names) {
        const normalizedName = normalizeTitle(name);
        const candidate = (score: number, reason: AniListCandidateScore["reason"]) => {
          if (score > best.score || (score === best.score && `${name}` < `${best.matchedTitle ?? "~"}`))
            best = { media, score, matchedAlias: alias, matchedTitle: name, reason };
        };
        const exactKind = exactTitleMatchKind(alias, name);
        if (exactKind === "NORMALIZED_EXACT") candidate(100, "NORMALIZED_EXACT");
        else if (exactKind === "COMPACT_EXACT") candidate(98, "COMPACT_EXACT");
        else if (exactKind === "PARENTHESIZED_EXACT") candidate(96, "COMPACT_EXACT");
        else if ((normalizedName.includes(normalizedAlias) || normalizedAlias.includes(normalizedName) ||
          compactAlias.includes(compactTitleKey(name)) || compactTitleKey(name).includes(compactAlias)) &&
          !(normalizedAlias.split(" ").length >= 2 && normalizedName.split(" ").length === 1))
          candidate(76, "PARTIAL");
        else {
          const wanted = new Set(normalizedAlias.split(" ").filter((token) => token.length >= 2));
          const found = normalizedName.split(" ").filter((token) => wanted.has(token));
          if (wanted.size >= 2 && found.length / wanted.size >= 0.6)
            candidate(55 + Math.round((found.length / wanted.size) * 35), "TOKEN_OVERLAP");
        }
      }
    }
    return best;
  };
  const ranked = allowed.map((media) => ({ media, score: score(media) }))
    .filter((candidate) => candidate.score.score >= 76)
    .sort((a, b) => b.score.score - a.score.score || a.media.id - b.media.id);
  const first = ranked[0];
  if (!first) return null;
  const second = ranked[1];
  // Exact identities remain decisive. A prefix/suffix title is accepted only
  // when it is the unique partial identity with a clear lead; generic token
  // overlap alone is never enough to auto-select an AniList record.
  if (first.score.score < 96 &&
      (first.score.reason !== "PARTIAL" || (second && first.score.score - second.score.score < 12)))
    return null;
  const media = first.media;
  const titles = [
    media.title.userPreferred,
    media.title.english,
    media.title.romaji,
    media.title.native,
    ...media.synonyms,
  ].filter((value): value is string => Boolean(value));
  return { media, displayTitle: latinTitle(media), titles, score: first.score.score };
}
export function assertSafeImageUrl(value: string) {
  const u = new URL(value);
  if (u.protocol !== "https:") throw new Error("IMAGE_HTTPS_REQUIRED");
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || isIP(h))
    throw new Error("IMAGE_PRIVATE_IP");
  return u;
}
export async function downloadImage(
  value: string,
  options: { fetch?: SearchClient; maxBytes?: number; timeoutMs?: number } = {},
) {
  const url = assertSafeImageUrl(value);
  const r = await (
    options.fetch ??
    safeFetch(options.maxBytes ?? 5 * 1024 * 1024, [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
    ])
  )(url, {
    headers: {
      "user-agent": UA,
      ...(url.hostname === "mangaupdates.com" ||
      url.hostname.endsWith(".mangaupdates.com")
        ? { referer: "https://www.mangaupdates.com/" }
        : {}),
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
  });
  if (!r.ok) throw new Error(`IMAGE_HTTP_${r.status}`);
  const type = r.headers.get("content-type")?.split(";")[0];
  if (!type?.startsWith("image/")) throw new Error("IMAGE_MIME_INVALID");
  const data = Buffer.from(await r.arrayBuffer());
  if (data.length > (options.maxBytes ?? 5 * 1024 * 1024))
    throw new Error("IMAGE_TOO_LARGE");
  return { data, mimeType: type, sourceUrl: url.toString() };
}

export type MangaUpdatesSeries = {
  id: string;
  title?: string;
  titles?: string[];
  /** Title returned by the provider as the search hit, when it differs from the record title. */
  hitTitle?: string;
  type?: string;
  format?: string;
  year?: number;
  status?: string;
  completed?: boolean;
  licensed?: boolean;
  genres?: string[];
  categories?: string[];
  bayesianRating?: number;
  ratingVotes?: number;
  lastUpdated?: string;
  startDate?: string;
  authors?: string[];
  publishers?: string[];
  publications?: string[];
  description?: string;
  latestChapter?: string;
  latestVolume?: string;
  url?: string;
  image?: string;
  imageThumbnail?: string;
  relations?: unknown[];
  associated?: string[];
  relatedSeries?: unknown[];
};
export type MangaUpdatesRelease = {
  seriesId?: string;
  seriesTitle?: string;
  title?: string;
  titles?: string[];
  chapter?: string;
  volume?: string;
  releaseDate?: string;
  status?: string;
  group?: string;
  language?: string;
  url?: string;
  raw?: unknown;
};
export type MangaUpdatesClientOptions = {
  endpoint?: string;
  searchEndpoint?: string;
  fetch?: SearchClient;
  timeoutMs?: number;
  now?: number;
  startDate?: string;
  endDate?: string;
  pageSize?: number;
};
const MU_BASE = "https://api.mangaupdates.com/v1";
function muClient(options: MangaUpdatesClientOptions) {
  return options.fetch ?? safeFetch(JSON_MAX, ["application/json"]);
}
function muHeaders(options: MangaUpdatesClientOptions) {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "user-agent": UA,
  };
}
function muArray(json: any, keys: string[]) {
  for (const key of keys) if (Array.isArray(json?.[key])) return json[key];
  return Array.isArray(json) ? json : [];
}
function stringValues(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (value && typeof value === "object")
    return Object.values(value as Record<string, unknown>).filter(
      (item): item is string =>
        typeof item === "string" && item.trim().length > 0,
    );
  return [];
}
function titleValues(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value] : [];
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const titleKeys = new Set(["title", "name", "text", "value", "english", "romaji", "native", "translation", "localized", "display"]);
  const direct = Object.entries(object)
    .filter(([key]) => titleKeys.has(key.toLowerCase()))
    .flatMap(([, item]) => titleValues(item));
  if (direct.length) return direct;
  return Object.entries(object)
    .filter(([key]) => !/^(?:id|language|lang|script|type|format|url|source)$/iu.test(key))
    .flatMap(([, item]) => typeof item === "string" && item.trim() ? [item] : []);
}
function imageValue(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    try {
      return new URL(value, "https://www.mangaupdates.com/").toString();
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== "object") return undefined;
  const object = value as any;
  const candidate =
    imageValue(object.url) ?? imageValue(object.original) ?? imageValue(object.src) ?? imageValue(object.href);
  if (candidate) return candidate;
  return undefined;
}
function mapMuSeries(value: any): MangaUpdatesSeries | null {
  const record = value?.record ?? value;
  const id =
    record?.series_id ?? record?.seriesId ?? record?.id ?? record?.record_id;
  if (id === undefined || id === null) return null;
  const associated = Array.isArray(record?.associated)
    ? record.associated.flatMap(titleValues)
    : [];
  const hitTitle = stringValues(value?.hit_title ?? value?.hitTitle ?? record?.hit_title ?? record?.hitTitle)[0];
  const titles = [
    ...stringValues(record.title),
    ...stringValues(record.name),
    ...(Array.isArray(record.titles)
      ? record.titles.flatMap(titleValues)
      : []),
    ...(Array.isArray(record.alternative_titles)
      ? record.alternative_titles.flatMap(titleValues)
      : []),
    ...associated,
  ]
    .flat()
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return {
    id: String(id),
    title: stringValues(record.title ?? record.name)[0],
    titles: [...new Set(titles)],
    hitTitle,
    type: record.type ?? record.series_type,
    year:
      Number(record.year ?? record.start_year ?? record.release_year) ||
      undefined,
    status: record.status ?? record.serialization_status,
    completed: typeof record.completed === "boolean" ? record.completed : undefined,
    licensed: typeof record.licensed === "boolean" ? record.licensed : undefined,
    genres: Array.isArray(record.genres) ? record.genres.flatMap(titleValues) : [],
    categories: Array.isArray(record.categories) ? record.categories.flatMap(titleValues) : [],
    bayesianRating: Number(record.bayesian_rating ?? record.bayesianRating) || undefined,
    ratingVotes: Number(record.rating_votes ?? record.ratingVotes) || undefined,
    lastUpdated: record.last_updated ?? record.lastUpdated,
    startDate:
      record.start_date ?? record.startDate ?? record.created_at ?? record.createdAt ??
      (record.year ? String(record.year) : undefined),
    authors: Array.isArray(record.authors) ? record.authors.flatMap(titleValues) : [],
    publishers: Array.isArray(record.publishers) ? record.publishers.flatMap(titleValues) : [],
    publications: Array.isArray(record.publications) ? record.publications.flatMap(titleValues) : [],
    description: record.description,
    image:
      imageValue(record.image) ??
      imageValue(record.cover_image) ??
      imageValue(record.cover),
    imageThumbnail: imageValue(record.image?.url?.thumbnail ?? record.image?.thumbnail),
    relations: Array.isArray(record.relations) ? record.relations : [],
    associated,
    relatedSeries: Array.isArray(record.related_series) ? record.related_series : [],
    latestChapter: record.latest_chapter ?? record.latestChapter,
    latestVolume: record.latest_volume ?? record.latestVolume,
    url: record.url,
  };
}
function mapMuRelease(value: any): MangaUpdatesRelease | null {
  const record=value?.record??value;
  const series = value?.metadata?.series ?? value?.series ?? value?.manga ?? record?.series ?? {};
  const id = value?.series_id ?? value?.seriesId ?? series?.series_id ?? series?.id;
  const titles = [
    value?.series_title,
    record?.title,
    series?.title,
    ...(Array.isArray(value?.titles) ? value.titles : []),
  ].filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  if (id === undefined && titles.length === 0) return null;
  return {
    seriesId: id === undefined ? undefined : String(id),
    seriesTitle: titles[0],
    title: record?.title,
    titles: [...new Set(titles)],
    chapter:
      String(record?.chapter ?? record?.chapter_number ?? record?.number ?? "") ||
      undefined,
    volume: String(record?.volume ?? record?.volume_number ?? "") || undefined,
    releaseDate: record?.release_date ?? record?.released_at ?? record?.date,
    status: value?.serialization_status ?? value?.status ?? series?.status,
    group: Array.isArray(record?.groups)?record.groups.map((group:any)=>group?.name).filter(Boolean).join(' · '):(record?.group_name ?? record?.group?.name ?? record?.group),
    language: record?.language,
    url: series?.url ?? record?.url,
    raw: value,
  };
}
async function muJson(
  path: string,
  options: MangaUpdatesClientOptions,
  init: RequestInit = {},
  endpoint?: string,
) {
  const client = muClient(options);
  const base = `${(endpoint ?? options.endpoint ?? MU_BASE).replace(/\/+$/, "")}/`;
  const response = await client(new URL(path.replace(/^\/+/, ""), base), {
    ...init,
    headers: { ...muHeaders(options), ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(options.timeoutMs ?? 8000),
  });
  if (response.status === 429)
    throw new Error(
      `MANGAUPDATES_HTTP_429_RETRY_${response.headers.get("retry-after") ?? ""}`,
    );
  if (!response.ok) throw new Error(`MANGAUPDATES_HTTP_${response.status}`);
  return boundedJson(response);
}
export async function fetchMangaUpdatesReleases(
  options: MangaUpdatesClientOptions = {},
): Promise<MangaUpdatesRelease[]> {
  // MangaUpdates documents this release-search endpoint without an API key.
  // Do not invent an Authorization header or introduce a secret-file contract.
  const now = new Date(options.now ?? Date.now());
  const startDate = options.startDate ?? now.toISOString().slice(0, 10);
  const endDate = options.endDate ?? new Date(now.getTime() + 14 * 86_400_000).toISOString().slice(0, 10);
  const perPage = Math.min(100, Math.max(1, options.pageSize ?? 100));
  const releases: MangaUpdatesRelease[] = [];
  for (let page = 1; ; page++) {
    const json = await muJson("/releases/search", options, {
      method: "POST",
      body: JSON.stringify({ start_date: startDate, end_date: endDate, include_metadata: true, page, perpage: perPage }),
    });
    const raw = muArray(json, ["releases", "results", "data"]);
    releases.push(...raw.map(mapMuRelease).filter((x): x is MangaUpdatesRelease => Boolean(x)));
    const total = Number(json?.total_hits ?? json?.totalHits ?? json?.pagination?.total_hits ?? releases.length);
    if (!raw.length || releases.length >= total) break;
    if (page >= 10_000) throw new Error("MANGAUPDATES_PAGINATION_LIMIT");
  }
  return releases;
}
export async function searchMangaUpdatesSeries(
  query: string,
  options: MangaUpdatesClientOptions = {},
): Promise<MangaUpdatesSeries[]> {
  const q = query.trim().slice(0, 200);
  if (!q) return [];
  const json = await muJson(
    "/series/search",
    options,
    { method: "POST", body: JSON.stringify({ search: q }) },
    options.searchEndpoint,
  );
  const resultList = ["series", "results", "data"].find((key) => Array.isArray(json?.[key]));
  if (!resultList && !Array.isArray(json)) throw new Error("MANGAUPDATES_EMPTY_RESPONSE");
  const rawItems = muArray(json, ["series", "results", "data"]);
  const mapped = rawItems.map(mapMuSeries).filter((x): x is MangaUpdatesSeries => Boolean(x));
  if (rawItems.length > 0 && mapped.length === 0) throw new Error("MANGAUPDATES_PARSE_ERROR");
  return mapped;
}
export async function fetchMangaUpdatesSeries(
  id: string,
  options: MangaUpdatesClientOptions = {},
): Promise<MangaUpdatesSeries> {
  if (!id.trim()) throw new Error("MANGAUPDATES_ID_INVALID");
  return (
    mapMuSeries(await muJson(`/series/${encodeURIComponent(id)}`, options)) ??
    (() => {
      throw new Error("MANGAUPDATES_SERIES_NOT_FOUND");
    })()
  );
}
/** Preserve the raw title while exposing only an explicit final parenthesized
 * segment as an alternate identity alias. Both provider pipelines use this
 * same bounded rule; nested or empty parentheses are never guessed. */
export function explicitTitleAliases(values: string[]) {
  const aliases = new Set<string>();
  for (const value of values) {
    const raw = typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
    if (!raw) continue;
    aliases.add(raw);
    const match = raw.match(/^(\S(?:.*\S)?)\s+\(([^()]+)\)$/u);
    if (!match) continue;
    const base = match[1].trim(), alternate = match[2].trim();
    if (base.length >= 2) aliases.add(base);
    if (alternate.length >= 2) aliases.add(alternate);
  }
  return [...aliases];
}

export function titleVariants(values: string[]) {
  const result = new Set<string>();
  const rawValues = explicitTitleAliases(values);
  for (const raw of rawValues) result.add(raw);
  for (const raw of rawValues) {
    const normalized = normalizeTitle(raw);
    if (normalized) result.add(normalized);
  }
  for (const raw of rawValues) {
    const normalized = normalizeTitle(raw);
    const compact = normalized.replace(/\s+/g, "");
    if (compact) result.add(compact);
  }
  return [...result];
}

const MU_NOVEL_TYPES = /(?:light\s*)?novel|web\s*novel|visual\s*novel|webnovel/u;

export function mangaUpdatesMediaType(value: unknown): "MANGA" | "MANHWA" | "MANHUA" | undefined {
  const type = String(value ?? "").trim().toLowerCase();
  if (type === "manga") return "MANGA";
  if (type === "manhwa") return "MANHWA";
  if (type === "manhua") return "MANHUA";
  return undefined;
}

function mangaUpdatesOelComicEvidence(series: MangaUpdatesSeries) {
  if (String(series.type ?? "").trim().toLowerCase() !== "oel") return false;
  const evidence = [
    series.status,
    ...(series.categories ?? []),
    ...(series.publications ?? []),
  ].filter(Boolean).join(" ").toLowerCase();
  return /\bchapters?\b|\bwebtoon\b|\bwebcomic\b|\bcomic\b/u.test(evidence);
}

const TITLE_STOP_WORDS = new Set([
  "a", "an", "and", "as", "at", "be", "by", "for", "from", "in", "is", "it", "its",
  "no", "of", "on", "or", "the", "to", "wa", "ga", "ni",
]);
const ORDINAL_WORDS = new Map(Object.entries({
  first: "1", second: "2", third: "3", fourth: "4", fifth: "5",
  sixth: "6", seventh: "7", eighth: "8", ninth: "9", tenth: "10",
  eleventh: "11", twelfth: "12", thirteenth: "13", fourteenth: "14",
  fifteenth: "15", sixteenth: "16", seventeenth: "17", eighteenth: "18",
  nineteenth: "19", twentieth: "20",
}));

export const PROVIDER_TITLE_MATCHER_VERSION = "provider-title-v3";
export type ProviderTitleMatchMethod =
  | "ordered-exact"
  | "explicit-season"
  | "reordered-significant-words"
  | "bounded-edit-distance";
export type ProviderTitleMatchDecision<T> = {
  status: "MATCH" | "AMBIGUOUS" | "NO_MATCH";
  method?: ProviderTitleMatchMethod;
  candidate?: T;
  matchedAlias?: string;
  providerTitle?: string;
  providerId?: string;
  matcherVersion: typeof PROVIDER_TITLE_MATCHER_VERSION;
  rawProvenance: { aliases: string[] };
};

/** Identity-bearing title tokens. This deliberately normalizes grammar and
 * ordinal spelling, but never invents provider-specific aliases. */
function meaningfulTokens(value: string) {
  return normalizeTitle(value)
    .split(" ")
    .map((token) => token.replace(/^(\d+)(?:st|nd|rd|th)$/u, "$1"))
    .map((token) => ORDINAL_WORDS.get(token) ?? token)
    .map((token) => /^(?:return|returns|returned|returning)$/u.test(token) ? "return" : token)
    .filter((token) => token.length >= 2 && !TITLE_STOP_WORDS.has(token));
}

export function mangaUpdatesCandidateTitles(series: MangaUpdatesSeries) {
  return [series.hitTitle, series.title, ...(series.titles ?? []), ...(series.associated ?? [])]
    .filter((value): value is string => Boolean(value?.trim()))
    .map((value) => value.trim());
}
const candidateTitles = mangaUpdatesCandidateTitles;

/** Returns provider records whose complete returned title set exactly identifies an alias. */
export function exactMangaUpdatesSeriesMatches(
  aliases: string[],
  items: MangaUpdatesSeries[],
) {
  return [...new Map(items
    .filter((item) => mangaUpdatesTypeAllowed(item) && !isDeadMangaUpdatesSeries(item))
    .filter((item) => preSerializationCandidateAllowed(aliases, candidateTitles(item)))
    .filter((item) => candidateTitles(item).some((title) =>
      aliases.some((alias) => exactTitleMatchKind(alias, title))))
    .map((item) => [item.id, item] as const)).values()];
}

/** Automatic identity is deliberately narrower than review relevance: spelling
 * differences, token overlap and parenthesized variants require a human. */
export function automaticMangaUpdatesSeriesMatches(aliases: string[], items: MangaUpdatesSeries[]) {
  return [...new Map(items
    .filter((item) => mangaUpdatesTypeAllowed(item) && !isDeadMangaUpdatesSeries(item))
    .filter((item) => preSerializationCandidateAllowed(aliases, candidateTitles(item)))
    .filter((item) => candidateTitles(item).some((title) => aliases.some((alias) => {
      const kind=exactTitleMatchKind(alias,title);
      return kind==='NORMALIZED_EXACT'||kind==='COMPACT_EXACT';
    })))
    .map((item) => [item.id,item] as const)).values()];
}

function titleEditDistance(left: string, right: string) {
  const a = compactTitleKey(left), b = compactTitleKey(right);
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]; row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const saved = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = saved;
    }
  }
  return row[b.length];
}

/** Shared, provider-neutral identity policy. Input ordering and audience fields
 * are deliberately ignored. A tie at any level is an ambiguity. */
export function decideProviderTitleMatch<T>(input: {
  aliases: string[];
  candidates: T[];
  id: (candidate: T) => string;
  titles: (candidate: T) => string[];
  explicitSeason?: (alias: string, candidate: T) => boolean;
}): ProviderTitleMatchDecision<T> {
  const rawProvenance = { aliases: [...input.aliases] };
  const unique = [...new Map(input.candidates.map(candidate => [input.id(candidate), candidate] as const)).values()];
  const chooseLevel = (method: ProviderTitleMatchMethod, matches: Array<{candidate:T;alias:string;title:string}>) => {
    const byId = [...new Map(matches.map(match => [input.id(match.candidate), match] as const)).values()];
    if (byId.length > 1) return { status: "AMBIGUOUS", method, matcherVersion: PROVIDER_TITLE_MATCHER_VERSION, rawProvenance } as ProviderTitleMatchDecision<T>;
    const match = byId[0];
    if (!match) return undefined;
    return { status: "MATCH", method, candidate: match.candidate, matchedAlias: match.alias, providerTitle: match.title, providerId: input.id(match.candidate), matcherVersion: PROVIDER_TITLE_MATCHER_VERSION, rawProvenance } as ProviderTitleMatchDecision<T>;
  };
  const pairs = unique.flatMap(candidate => input.aliases.flatMap(alias => input.titles(candidate).map(title => ({candidate,alias,title}))));
  const exact = chooseLevel("ordered-exact", pairs.filter(({alias,title}) => {
    const kind = exactTitleMatchKind(alias,title);
    return kind === "NORMALIZED_EXACT" || kind === "COMPACT_EXACT";
  }));
  if (exact) return exact;
  if (input.explicitSeason) {
    const season = chooseLevel("explicit-season", unique.flatMap(candidate => input.aliases.filter(alias => input.explicitSeason!(alias,candidate)).map(alias => ({candidate,alias,title:input.titles(candidate)[0] ?? ""}))));
    if (season) return season;
  }
  const tokenKey = (value:string) => meaningfulTokens(value).sort().join("|");
  const reordered = chooseLevel("reordered-significant-words", pairs.filter(({alias,title}) => Boolean(tokenKey(alias)) && tokenKey(alias) === tokenKey(title)));
  if (reordered) return reordered;
  const boundedTokenPairs = pairs.filter(({alias,title}) => {
    const left=meaningfulTokens(alias),right=meaningfulTokens(title);
    if (!left.length||!right.length) return false;
    const remaining=[...right];
    let exactCount=0;
    for(const token of left){const index=remaining.indexOf(token);if(index<0)continue;exactCount++;remaining.splice(index,1);}
    return exactCount>=3&&exactCount/left.length>=2/3;
  });
  const tokenBounded=chooseLevel("bounded-edit-distance",boundedTokenPairs);
  if(tokenBounded)return tokenBounded;
  const ranked = pairs.map(pair => ({...pair,distance:titleEditDistance(pair.alias,pair.title)}))
    .sort((a,b)=>a.distance-b.distance||input.id(a.candidate).localeCompare(input.id(b.candidate))||a.title.localeCompare(b.title));
  const best = ranked[0];
  if (!best || best.distance > 4) return {status:"NO_MATCH",matcherVersion:PROVIDER_TITLE_MATCHER_VERSION,rawProvenance};
  const competing = ranked.find(entry => input.id(entry.candidate) !== input.id(best.candidate));
  if (competing && competing.distance - best.distance < 3)
    return {status:"AMBIGUOUS",method:"bounded-edit-distance",matcherVersion:PROVIDER_TITLE_MATCHER_VERSION,rawProvenance};
  return {status:"MATCH",method:"bounded-edit-distance",candidate:best.candidate,matchedAlias:best.alias,providerTitle:best.title,providerId:input.id(best.candidate),matcherVersion:PROVIDER_TITLE_MATCHER_VERSION,rawProvenance};
}

/** Prefer the user-visible favorite title. A small typo is accepted only when
 * the winner is unique and clearly ahead of every other provider record. */
export function preferredMangaUpdatesSeriesMatch(aliases: string[], items: MangaUpdatesSeries[]) {
  return decideMangaUpdatesTitleMatch(aliases,items).candidate;
}

export function decideMangaUpdatesTitleMatch(aliases:string[],items:MangaUpdatesSeries[]) {
  const eligible=items.filter(item=>mangaUpdatesTypeAllowed(item)&&!isDeadMangaUpdatesSeries(item))
    .filter(item=>preSerializationCandidateAllowed(aliases,candidateTitles(item)));
  return decideProviderTitleMatch({aliases,candidates:eligible,id:item=>item.id,titles:candidateTitles});
}

export function preferredAniListMediaMatch(aliases: string[], items: AniListMedia[]) {
  return decideAniListTitleMatch(aliases,items).candidate;
}

export function decideAniListTitleMatch(aliases:string[],items:AniListMedia[]) {
  const titles = (item: AniListMedia) => [item.title.english,item.title.romaji,item.title.userPreferred,item.title.native,...item.synonyms]
    .filter((value): value is string => Boolean(value?.trim()));
  const eligible=items.filter(item=>item.type==='ANIME');
  return decideProviderTitleMatch({aliases,candidates:eligible,id:item=>String(item.id),titles,explicitSeason:aniListExplicitSeasonMatch});
}

/** AniList may carry the localized base title and the explicit season number
 * in different title fields. The trailing source number is used only when a
 * provider title independently says `Season N`; it is never rewritten alone. */
export function aniListExplicitSeasonMatch(alias: string, item: AniListMedia) {
  const parsed = normalizeTitle(alias).match(/^(.*\S)\s+(\d{1,2})$/u);
  if (!parsed) return false;
  const [, aliasBase, season] = parsed;
  const titles = [item.title.english,item.title.romaji,item.title.userPreferred,item.title.native,...item.synonyms]
    .filter((title):title is string=>Boolean(title?.trim()));
  const hasBase = titles.some(title => {
    const providerBase = title.split(/[:：]/u,1)[0]?.trim() ?? title;
    return normalizeTitle(providerBase) === aliasBase || compactTitleKey(providerBase) === compactTitleKey(aliasBase);
  });
  const hasSeason = titles.some(title => {
    const normalized = normalizeTitle(title);
    return new RegExp(`(?:^|\\s)(?:season|saison)\\s+${season}(?:\\s|$)|(?:^|\\s)${season}(?:st|nd|rd|th)\\s+season(?:\\s|$)`, 'u').test(normalized);
  });
  return hasBase && hasSeason;
}

export function exactAniListMediaMatches(aliases: string[], items: AniListMedia[]) {
  return [...new Map(items
    .filter((item) => item.type === "ANIME")
    .filter((item) => [
      item.title.english,
      item.title.romaji,
      item.title.userPreferred,
      item.title.native,
      ...item.synonyms,
    ].filter((title): title is string => Boolean(title?.trim())).some((title) =>
      aliases.some((alias) => exactTitleMatchKind(alias, title))))
    .map((item) => [item.id, item] as const)).values()];
}

export function automaticAniListMediaMatches(aliases: string[], items: AniListMedia[]) {
  return [...new Map(items.filter((item) => [item.title.english,item.title.romaji,item.title.userPreferred,item.title.native,...item.synonyms]
    .filter((title):title is string=>Boolean(title?.trim()))
    .some((title)=>aliases.some((alias)=>{const kind=exactTitleMatchKind(alias,title);return kind==='NORMALIZED_EXACT'||kind==='COMPACT_EXACT'||kind==='SUBTITLE_EXACT'||kind==='ALIAS_PARENTHESIZED_EXACT';})) || aliases.some(alias=>aniListExplicitSeasonMatch(alias,item)))
    .map((item)=>[item.id,item] as const)).values()];
}

function hasValidChapter(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0;
  if (typeof value !== "string") return false;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0;
}

/** A provider search hit with none of its useful identity/metadata fields is a dead record. */
export function isDeadMangaUpdatesSeries(series: MangaUpdatesSeries) {
  return !series.image && !series.description && !series.year &&
    !series.status && !hasValidChapter(series.latestChapter);
}

export function mangaUpdatesTypeAllowed(series: MangaUpdatesSeries) {
  const values = [series.type, series.format].filter(Boolean).join(" ").toLowerCase();
  if (MU_NOVEL_TYPES.test(values)) return false;
  return !values || Boolean(mangaUpdatesMediaType(series.type) ?? mangaUpdatesMediaType(series.format)) ||
    mangaUpdatesOelComicEvidence(series);
}

export type ScoredMangaUpdatesCandidate = MangaUpdatesSeries & { score: number };

function scoreMangaUpdatesSeries(aliases: string[], series: MangaUpdatesSeries) {
  const exactNames = [series.hitTitle, series.title].filter((value): value is string => Boolean(value?.trim()));
  const names = candidateTitles(series);
  const normalizedAliases = aliases.map(normalizeTitle).filter(Boolean);
  let best = 0;
  for (const alias of normalizedAliases) {
    for (const name of names) {
      const normalizedName = normalizeTitle(name);
      const exactKind = exactTitleMatchKind(alias, name);
      if (exactKind === "NORMALIZED_EXACT")
        best = Math.max(best, exactNames.includes(name) ? 120 : 105);
      else if (exactKind === "COMPACT_EXACT" || exactKind === "PARENTHESIZED_EXACT")
        best = Math.max(best, exactNames.includes(name) ? 118 : 103);
      else if (normalizedName.includes(alias) || alias.includes(normalizedName)) best = Math.max(best, 76);
      const wanted = new Set(meaningfulTokens(alias));
      const offered = new Set(meaningfulTokens(name));
      const intersection = [...wanted].filter((token) => offered.has(token)).length;
      const smaller = Math.min(wanted.size, offered.size);
      const larger = Math.max(wanted.size, offered.size);
      const containment = smaller ? intersection / smaller : 0;
      const coverage = larger ? intersection / larger : 0;
      const dice = wanted.size + offered.size
        ? (2 * intersection) / (wanted.size + offered.size)
        : 0;
      // Require several shared identity tokens and strong symmetric coverage.
      // Function words cannot inflate the result, while harmless grammatical
      // rewrites and ordinal spelling remain equivalent.
      if (intersection >= 3 && containment >= 0.8 && coverage >= 0.6 && dice >= 0.7)
        best = Math.max(best, 55 + Math.round(dice * 35));
    }
  }
  return best + (series.hitTitle ? 3 : 0) + (series.image ? 2 : 0) + (series.description ? 1 : 0);
}

export function rankMangaUpdatesReviewCandidates(aliases: string[], items: MangaUpdatesSeries[], limit = 5) {
  return [...new Map(items.map((item) => [item.id,item] as const)).values()]
    .filter((item) => mangaUpdatesTypeAllowed(item) && !isDeadMangaUpdatesSeries(item))
    .filter((item) => preSerializationCandidateAllowed(aliases, candidateTitles(item)))
    .map((item) => ({item,score:scoreMangaUpdatesSeries(aliases,item)}))
    .sort((a,b)=>b.score-a.score||a.item.id.localeCompare(b.item.id))
    .slice(0,Math.max(0,limit))
    .map(({item})=>item);
}

/** Selects the coherent MangaUpdates identity, independently of result order. */
export function resolveMangaUpdatesSeries(
  aliases: string[],
  items: MangaUpdatesSeries[],
): ScoredMangaUpdatesCandidate | null {
  const ranked = items
    .filter((item) => mangaUpdatesTypeAllowed(item) && !isDeadMangaUpdatesSeries(item))
    .filter((item) => preSerializationCandidateAllowed(aliases, candidateTitles(item)))
    .map((item) => ({ ...item, score: scoreMangaUpdatesSeries(aliases, item) }))
    .filter((item) => item.score >= 55)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const first = ranked[0];
  if (!first) return null;
  const second = ranked[1];
  // Exact identities are decisive. A fuzzy identity must have a clear lead so
  // provider ordering can never silently choose between plausible works.
  if (first.score < 100 && second && first.score - second.score < 8) return null;
  return first;
}

export type MangaUpdatesMatch = {
  series: MangaUpdatesSeries;
  displayTitle: string;
  titles: string[];
};
export function matchMangaUpdates(
  query: {
    aliases: string[];
    type?: string;
    year?: number;
    country?: string;
    format?: string;
  },
  items: MangaUpdatesSeries[],
): MangaUpdatesMatch | null {
  const series = resolveMangaUpdatesSeries(query.aliases, items);
  if (!series) return null;
  const titles = [series.title, ...(series.titles ?? [])].filter(
    (value): value is string => Boolean(value),
  );
  return {
    series,
    displayTitle:
      series.title ??
      series.titles?.find(Boolean) ??
      `MangaUpdates ${series.id}`,
    titles,
  };
}
