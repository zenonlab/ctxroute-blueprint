export type BookmarkSourceEvidence = {
  key?: string;
  title: string;
  type: "ANIME" | "MANGA" | "MANHWA" | "MANHUA" | string;
  slug?: string;
  /** Exact slug observed in the URL before title-corroborated cleanup. */
  rawSlug?: string;
  canonicalUrl?: string;
  releaseSuffix?: string;
  /** Aliases whose identity has already been established by FavLib. */
  aliases?: string[];
  /** Explicit season carried by a trusted URL adapter. */
  season?: number;
  /** URL parser evidence copied into the immutable parse artifact. */
  strategy?: string;
  evidence?: string[];
};

export type TitleMatchMethod = "ordered-exact" | "reordered-significant-words" | "bounded-edit-distance";

export type ProgressionEvidence = {
  source: "bookmark-title" | "url-path";
  evidence: "explicit-marker" | "separated-release" | "labelled-url-path" | "numeric-url-segment-after-source-identity" | "bare-number-after-validated-identity" | "season-divergence";
  inputTitle: string;
  inputUrl: string;
  parsedTitle: string | null;
  slug?: string;
  pathSegments: string[];
  releaseSuffix?: string;
  matchedAlias?: string;
  matchMethod?: TitleMatchMethod;
  urlSeason?: number;
  titleSeason?: number;
  localNumber?: number;
  /** Every progression-like fragment considered by the shared parser. */
  candidates: ProgressionCandidateProvenance[];
  /** Candidates not selected, with an auditable deterministic reason. */
  rejectedCandidates: ProgressionRejectedCandidate[];
  parserVersion: number;
};

export type ProgressionCandidateProvenance = {
  kind: "chapter" | "episode" | "volume";
  raw: string;
  number: number;
  source: ProgressionEvidence["source"];
  evidence: ProgressionEvidence["evidence"];
  segment?: string;
  segmentIndex?: number;
  occurrence: number;
};

export type ProgressionRejectedCandidate = ProgressionCandidateProvenance & {
  reason: "EXPLICIT_EVIDENCE_PRESENT" | "LOWER_QUALITY_EVIDENCE" | "EARLIER_SAME_QUALITY_EVIDENCE" | "INCOMPATIBLE_KIND";
};

export type FavoriteProgression = {
  kind: "chapter" | "episode" | "volume";
  number: number;
  raw: string;
  season?: number;
  localNumber?: number;
  globalNumber?: number;
  provenance: ProgressionEvidence;
};

/** Increment only when the generic evidence policy changes. */
export const FAVORITE_PARSER_ID = "favorite-parser-v13" as const;
export const FAVORITE_IDENTITY_PARSER_VERSION = 13;
export const FAVORITE_PROGRESS_PARSER_VERSION = 10;

export type FavoriteParseArtifact = {
  parser: typeof FAVORITE_PARSER_ID;
  version: typeof FAVORITE_IDENTITY_PARSER_VERSION;
  fingerprint: string;
  raw: { title: string; url: string };
  provenance: {
    rawTitle: string;
    rawUrl: string;
    identityTransformations: Array<{ kind: string; raw: string; rawTitle?: string; corroboratedBy?: string }>;
  };
  identity: null | {
    key: string;
    title: string;
    /** Exact URL slug and the title-corroborated stable identity slug. */
    rawSlug: string;
    stableSlug: string;
    slug: string;
    canonicalUrl: string;
    type: BookmarkSourceEvidence["type"];
    strategy?: string;
    evidence: string[];
    aliases: Array<{ value: string; provenance: "stable-url-slug" | "aligned-bookmark-segment" }>;
    transformations: Array<{ kind: "numeric-routing-prefix" | "language-marker" | "reader-brand-suffix" | "opaque-url-slug-replaced" | "repeated-human-title"; raw: string; rawTitle?: string; corroboratedBy?: string }>;
  };
  segments: Array<{ raw: string; cleaned: string | null; transformations: string[]; excludedAs?: "progression" | "numeric" | "release" }>;
  displayTitle: string | null;
  /** Season identity evidence is independent from release progression. */
  seasonEvidence?: { season?: number; urlSeason?: number; titleSeason?: number; conflict: boolean };
  progression: FavoriteProgression | null;
  status: "parsed" | "identity-missing";
  diagnostics: string[];
};

const noise = /^(?:vostfr|vf|vo|sub|dub|scan|scans|english|français)$/iu;
const marker = /(chapter|chapitre|chap|ch|episode|épisode|ep|volume|vol)[-_.\s]*#?\s*(\d+(?:[.,]\d+)?)/giu;
const seasonLabel = "s|season|saison|temporada|stagione|staffel|seizoen|sesong|säsong|kausi|sezon|sezona|sezonas|сезон";
const seasonMarker = new RegExp(`(?:${seasonLabel})[-_.\\s]*(\\d{1,2})`, "iu");
const insignificant = new Set(["the", "a", "an", "of", "and", "et", "de", "la", "le", "les", "des", "episode", "chapter", "chapitre", "saison", "season", "vostfr", "vf", "vo", "sub", "dub"]);
const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const compact = (value: string) => normalize(value).replace(/\s/gu, "");
const words = (value: string) => normalize(value).split(" ").filter((word) => word.length > 1 && !insignificant.has(word));
const numberValue = (raw: string) => Number(raw.replace(",", "."));
const kindFor = (label: string): FavoriteProgression["kind"] => /^vol/iu.test(label) ? "volume" : /^(?:ep|épisode)/iu.test(label) ? "episode" : "chapter";

export type ExplicitAnimeSeasonTitle = {
  base: string;
  season: number;
  rawMarker: string;
  evidence: "explicit-season-marker" | "bare-trailing-number";
};

/** Shared season-title parser. `S4`, `Season 4`, and `Saison 4` are explicit
 * evidence; a bare final number remains distinguishable and cannot silently
 * become season identity without independent provider corroboration. */
export function parseExplicitAnimeSeasonTitle(value: string): ExplicitAnimeSeasonTitle | null {
  const title=value.replace(/\s+/gu," ").trim();
  const explicit=title.match(new RegExp(`^(.*\\S)\\s+((?:${seasonLabel})[-_.\\s]*(\\d{1,2}))$`,"iu"));
  if(explicit){
    const season=Number(explicit[3]);
    return season>0?{base:explicit[1].trim(),season,rawMarker:explicit[2],evidence:"explicit-season-marker"}:null;
  }
  const ordinal=title.match(/^(.*\S)\s+((\d{1,2})(?:st|nd|rd|th)[-_.\s]+season)$/iu);
  if(ordinal){
    const season=Number(ordinal[3]);
    return season>0?{base:ordinal[1].trim(),season,rawMarker:ordinal[2],evidence:"explicit-season-marker"}:null;
  }
  const bare=title.match(/^(.*\S)\s+(\d{1,2})$/u);
  if(!bare)return null;
  const season=Number(bare[2]);
  return season>0?{base:bare[1].trim(),season,rawMarker:bare[2],evidence:"bare-trailing-number"}:null;
}

/** URL-only explicit evidence. A compact labelled suffix is accepted only by
 * URL extraction; title parsing still requires a separator and preserves bare
 * trailing numbers as non-authoritative provenance. */
export function parseExplicitAnimeSeasonUrlSegment(value: string): ExplicitAnimeSeasonTitle | null {
  const segment=value.replace(/[_.-]+/gu," ").replace(/\s+/gu," ").trim();
  const standalone=segment.match(new RegExp(`^((?:${seasonLabel})\\s*(\\d{1,2}))$`,"iu"));
  if(standalone){const season=Number(standalone[2]);return season>0?{base:"",season,rawMarker:standalone[1],evidence:"explicit-season-marker"}:null;}
  const attached=value.match(new RegExp(`^(.+?)[_.\\-\\s]*((?:${seasonLabel})[-_.\\s]*(\\d{1,2}))$`,"iu"));
  if(!attached?.[1])return null;
  const season=Number(attached[3]);
  return season>0?{base:attached[1],season,rawMarker:attached[2],evidence:"explicit-season-marker"}:null;
}

function boundedDistance(left: string, right: string, maximum: number) {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row++) {
    const current = [row];
    let rowMinimum = row;
    for (let column = 1; column <= right.length; column++) {
      current[column] = Math.min(current[column - 1] + 1, previous[column] + 1, previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1));
      rowMinimum = Math.min(rowMinimum, current[column]);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previous = current;
  }
  return previous[right.length];
}

/** Shared provider-neutral identity proof. Ordering is part of the contract. */
export function matchValidatedTitle(value: string, aliases: string[]): { alias: string; method: TitleMatchMethod } | null {
  const candidate = normalize(value);
  if (!candidate) return null;
  for (const alias of aliases) if (normalize(alias) === candidate) return { alias, method: "ordered-exact" };
  const candidateWords = words(candidate).sort();
  for (const alias of aliases) {
    const aliasWords = words(alias).sort();
    if (candidateWords.length > 0 && candidateWords.length === aliasWords.length && candidateWords.every((word, index) => word === aliasWords[index])) return { alias, method: "reordered-significant-words" };
  }
  for (const alias of aliases) {
    const left = compact(candidate), right = compact(alias);
    const maximum = Math.min(2, Math.floor(Math.max(left.length, right.length) / 8));
    if (maximum > 0 && boundedDistance(left, right, maximum) <= maximum) return { alias, method: "bounded-edit-distance" };
  }
  return null;
}

function urlSegments(url: string) {
  try { return new URL(url).pathname.split("/").filter(Boolean).map((part) => { try { return decodeURIComponent(part); } catch { return part; } }); }
  catch { return []; }
}

export function parseBookmarkTitle(value: string) {
  let title = value.replace(/\s+/gu, " ").trim();
  title = title.replace(/^(?:read|watch|lire|regarder(?: gratuitement)?)\s+/iu, "");
  // Parenthesized release badges are not identity. Requiring an explicit
  // language/track marker avoids removing meaningful parenthetical work text.
  title = title.replace(/^\(\s*(?=[^)]*(?:vostfr|vf|vo|sub|dub))(?:(?:oav|ova|vostfr|vf|vo|sub|dub|raw)[\s,/+&-]*)+\)\s*/iu, "");
  for (let pass = 0; pass < 5; pass++) {
    const before = title;
    title = title
      .replace(/\s+(?:chapter|chapitre|chap|ch|episode|épisode|ep|volume|vol)\s*#?\s*\d+(?:[.,]\d+)?(?:[-\w]+)?(?:\s*\[[^\]]+\])?(?:(?:\s+|\s*[-|·:]\s*)(?:online|free|vostfr|vf|vo|sub|dub|scan|scans|[^\s]+).*)?$/iu, "")
      .replace(/\s+-\s+\d+(?:[.,]\d+)?(?:\s+(?:vostfr|vf|vo|sub|dub|scan|scans))?\s*$/iu, "")
      .replace(/\s+(?:in english online free|online free|en hd)\s*$/iu, "")
      .replace(/\s+(?:vostfr|vf|vo|sub|dub|scan|scans|en hd)\s*$/iu, "")
      .replace(/[|·:—–-]+$/u, "").trim();
    if (title === before) break;
  }
  const parts=title.split(/\s+-\s+/u).map((part)=>part.trim()).filter((part)=>part&&!noise.test(part)&&!/^\d+(?:[.,]\d+)?(?:\s+(?:vostfr|vf|vo|sub|dub|scan|scans))?$/iu.test(part));
  if(parts.length>1){const firstKey=compact(parts[0]);const duplicate=parts.slice(1).some((part)=>compact(part)===firstKey);if(duplicate)title=parts[0];}
  return title || null;
}

const splitSegments = (value: string) => value.split(/\s*(?:\||·|—|–)\s*|\s+-\s+/u).map(part => part.trim()).filter(Boolean);
const releaseOnly = /^(?:(?:chapter|chapitre|chap|ch|episode|épisode|ep|volume|vol|season|saison)[-_.\s]*#?\s*\d+(?:[.,]\d+)?(?:\s*\([^)]*(?:english|french|français|vostfr|vf|vo|sub|dub|scan|scans)[^)]*\))?|\d+(?:[.,]\d+)?(?:\s+(?:vostfr|vf|vo|sub|dub|scan|scans))?)$/iu;
const languageToken = /^(?:[a-z]{2}|[a-z]{2}-[a-z]{2,3}|english|french|français|japanese|korean|chinese)$/iu;

function tokenList(value: string) {
  return normalize(value).split(" ").filter(Boolean);
}

/** A structural URL fragment is removable only when the imported human title
 * proves the complete remaining identity. This deliberately does not guess
 * from a bare URL, so numeric and two-letter title prefixes remain intact. */
function alignStructuredSlug(rawSlug: string, title: string) {
  const transformations: Array<{ kind: "numeric-routing-prefix" | "language-marker" | "reader-brand-suffix"; raw: string }> = [];
  const titleWithoutRelease = parseBookmarkTitle(title) ?? title.trim();
  const bracket = titleWithoutRelease.match(/\s*\[([^\[\]]+)\]\s*$/u);
  const humanTitle = (bracket ? titleWithoutRelease.slice(0, bracket.index).trim() : titleWithoutRelease).trim();
  const slugTokens = tokenList(rawSlug), titleTokens = tokenList(humanTitle);
  if (!titleTokens.length || slugTokens.length < titleTokens.length) return null;
  const starts: number[] = [];
  for (let index = 0; index <= slugTokens.length - titleTokens.length; index++)
    if (titleTokens.every((token, offset) => slugTokens[index + offset] === token)) starts.push(index);
  if (starts.length !== 1) return null;
  const start = starts[0], before = slugTokens.slice(0, start), after = slugTokens.slice(start + titleTokens.length);
  const prefixValid = before.length === 0 || (before.length === 2 && /^\d+$/u.test(before[0]) && languageToken.test(before[1]));
  if (!prefixValid) return null;
  const brandTokens = bracket ? tokenList(bracket[1]) : [];
  const suffixValid = after.length === 0 || (brandTokens.length > 0 && after.length === brandTokens.length && after.every((token, index) => token === brandTokens[index]));
  if (!suffixValid) return null;
  if (before.length) {
    transformations.push({ kind: "numeric-routing-prefix", raw: before[0] });
    transformations.push({ kind: "language-marker", raw: before[1] });
  }
  if (after.length) transformations.push({ kind: "reader-brand-suffix", raw: bracket![1] });
  if (!transformations.length) return null;
  return { title: humanTitle, stableSlug: titleTokens.join("-"), transformations };
}

function fingerprint(value: string) {
  // Stable, runtime-neutral FNV-1a fingerprint. It detects stale parse artifacts;
  // it is not used as a security primitive.
  let hash = 2166136261;
  for (const char of value) { hash ^= char.codePointAt(0) ?? 0; hash = Math.imul(hash, 16777619); }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Canonical parser. Raw input is never mutated and progression fragments are
 * removed before any human title or identity alias can be emitted. */
export function parseFavorite(input: { title: string; url: string; source?: BookmarkSourceEvidence | null }): FavoriteParseArtifact {
  const raw = { title: input.title, url: input.url };
  const source = input.source ?? null;
  const progression = progressionFromFavorite({ ...input, source });
  const rawSegments = splitSegments(input.title);
  let observedHostLabel = "";
  let observedHostname = "";
  try { const hostname=new URL(input.url).hostname.replace(/^www\./iu, ""); observedHostLabel = normalize(hostname.split(".")[0] ?? ""); observedHostname=normalize(hostname).replace(/\s/gu,""); } catch { /* malformed input is diagnosed below */ }
  const segments = rawSegments.map(rawSegment => {
    const transformations: string[] = [];
    if (releaseOnly.test(rawSegment)) {
      marker.lastIndex = 0;
      return { raw: rawSegment, cleaned: null, transformations: ["excluded_progression"], excludedAs: "progression" as const };
    }
    marker.lastIndex = 0;
    if (/^\d+(?:[.,]\d+)?$/u.test(rawSegment)) return { raw: rawSegment, cleaned: null, transformations: ["excluded_numeric"], excludedAs: "numeric" as const };
    if (noise.test(rawSegment)) return { raw: rawSegment, cleaned: null, transformations: ["excluded_release_marker"], excludedAs: "release" as const };
    const compactSegment=normalize(rawSegment).replace(/\s/gu,"");
    if (observedHostLabel && (compactSegment === observedHostLabel.replace(/\s/gu, "") || compactSegment===observedHostname)) return { raw: rawSegment, cleaned: null, transformations: ["excluded_observed_hostname"], excludedAs: "release" as const };
    const cleaned = parseBookmarkTitle(rawSegment);
    if (cleaned !== rawSegment) transformations.push("cleaned_generic_suffix");
    return { raw: rawSegment, cleaned, transformations };
  });
  const rawSlug = source?.rawSlug ?? source?.slug ?? "";
  const structuredMatches = source && rawSlug
    ? [input.title,...segments.flatMap(segment=>segment.cleaned?[segment.cleaned]:[])]
      .map(candidate=>alignStructuredSlug(rawSlug,candidate)).filter((item):item is NonNullable<typeof item>=>Boolean(item))
    : [];
  const structuredByIdentity = [...new Map(structuredMatches.map(item=>[`${normalize(item.title)}|${item.stableSlug}`,item] as const)).values()];
  const structured = structuredByIdentity.length===1 ? structuredByIdentity[0] : null;
  // An opaque routing identity can be the whole slug or the final component
  // of a generic technical prefix. It is never promoted to a work identity
  // unless exactly one cleaned human title from the favorite corroborates it.
  const slugParts=rawSlug.split(/[-_.]+/u).filter(Boolean);
  const opaqueToken=(value:string)=>value.length>=6&&/^[\p{L}\d]+$/u.test(value)&&/\p{L}/u.test(value)&&/\d/u.test(value)&&!/^(?=.*\p{L}{4,})(?=.*\d{1,2}$)[\p{L}\d]+$/u.test(value);
  const opaqueSlug=Boolean(source&&(opaqueToken(rawSlug)||(slugParts.length>1&&slugParts.slice(0,-1).every(part=>/^\p{L}{2,16}$/u.test(part))&&opaqueToken(slugParts.at(-1)!))));
  const humanSegments=[...new Set(segments.flatMap(segment=>segment.cleaned?[segment.cleaned]:[]).filter(value=>normalize(value)!==normalize(source?.title??"")))];
  const opaqueReplacement=opaqueSlug&&humanSegments.length===1?humanSegments[0]:undefined;
  // Some catalogues prepend a numeric routing bucket to a readable slug. If
  // the imported bookmark independently supplies exactly one human identity,
  // that human title is stronger evidence than the routing slug. A bare URL,
  // or a bookmark that retains the numeric prefix, is deliberately unchanged.
  const numericRoutingToken=slugParts.length>1&&/^\d+$/u.test(slugParts[0])?slugParts[0]:undefined;
  const numericRoutingReplacement=!structured&&numericRoutingToken&&humanSegments.length===1
    ? humanSegments[0]
    : undefined;
  const repeatedHumanTitle=segments.find((segment,index)=>segment.cleaned&&segments.some((peer,peerIndex)=>peerIndex!==index&&peer.cleaned&&compact(peer.cleaned)===compact(segment.cleaned!)))?.cleaned;
  const stableSourceTitle = structured?.title ?? opaqueReplacement ?? numericRoutingReplacement ?? repeatedHumanTitle ?? source?.title;
  const stableSlug = structured?.stableSlug ?? ((opaqueReplacement??numericRoutingReplacement)?tokenList((opaqueReplacement??numericRoutingReplacement)!).join("-"):source?.slug) ?? compact(stableSourceTitle ?? "");
  const sourceAliases = source ? [stableSourceTitle, ...(source.aliases ?? [])].filter((value): value is string => Boolean(value)) : [];
  const aligned = sourceAliases.length
    ? segments.filter(segment => segment.cleaned).map(segment => ({ segment, proof: matchValidatedTitle(segment.cleaned!, sourceAliases) })).find(item => item.proof)
    : undefined;
  const aliases: Array<{ value: string; provenance: "stable-url-slug" | "aligned-bookmark-segment" }> = [];
  if (source) {
    aliases.push({ value: stableSourceTitle!, provenance: "stable-url-slug" });
    if (aligned?.segment.cleaned && aligned.segment.cleaned !== stableSourceTitle) aliases.push({ value: aligned.segment.cleaned, provenance: "aligned-bookmark-segment" });
  }
  const identity = source && !(opaqueSlug&&!opaqueReplacement) ? {
    key: structured||numericRoutingReplacement ? `${source.key ?? "source"}:${stableSlug}` : source.key ?? stableSlug,
    title: stableSourceTitle!, rawSlug, stableSlug, slug: stableSlug,
    canonicalUrl: source.canonicalUrl ?? input.url, type: source.type, strategy: source.strategy, evidence: [...(source.evidence??[])], aliases,
    transformations: structured?.transformations ?? (opaqueReplacement?[{kind:"opaque-url-slug-replaced" as const,raw:rawSlug,rawTitle:input.title,corroboratedBy:opaqueReplacement}]:numericRoutingReplacement?[{kind:"numeric-routing-prefix" as const,raw:numericRoutingToken!,rawTitle:input.title,corroboratedBy:numericRoutingReplacement}]:repeatedHumanTitle&&normalize(repeatedHumanTitle)!==normalize(source.title)?[{kind:"repeated-human-title" as const,raw:source.title,rawTitle:input.title,corroboratedBy:repeatedHumanTitle}]:[]),
  } : null;
  // Once the URL establishes an identity, its stable slug owns the displayed
  // parsed title too. A bookmark label such as "Ch 2 special" is release
  // context, not a safer work title than the URL identity. Human text still
  // replaces opaque/structured routing slugs only through the proofs above.
  const displayTitle = identity?.title ?? segments.find(segment => segment.cleaned)?.cleaned ?? parseBookmarkTitle(input.title);
  const titleSeason=parseExplicitAnimeSeasonTitle(parseBookmarkTitle(input.title) ?? input.title)?.season;
  const urlSeason=source?.season;
  const seasonConflict=urlSeason!==undefined&&titleSeason!==undefined&&urlSeason!==titleSeason;
  const seasonEvidence=(urlSeason!==undefined||titleSeason!==undefined)
    ? {season:seasonConflict?undefined:(urlSeason??titleSeason),urlSeason,titleSeason,conflict:seasonConflict}
    : undefined;
  return {
    parser: FAVORITE_PARSER_ID, version: FAVORITE_IDENTITY_PARSER_VERSION,
    fingerprint: fingerprint(JSON.stringify({ parser: FAVORITE_PARSER_ID, raw })), raw,
    provenance: { rawTitle: raw.title, rawUrl: raw.url, identityTransformations: identity?.transformations ?? [] },
    identity, segments, seasonEvidence,
    displayTitle, progression, status: identity ? "parsed" : "identity-missing",
    diagnostics: identity ? [] : [opaqueSlug ? "OPAQUE_IDENTITY_UNCORROBORATED" : "URL_IDENTITY_MISSING"],
  };
}

export function progressionFromFavorite(input: { title: string; url: string; source?: BookmarkSourceEvidence | null }): FavoriteProgression | null {
  const pathSegments = urlSegments(input.url);
  const parsedTitle = parseBookmarkTitle(input.title);
  const candidates: Array<FavoriteProgression & { candidate: ProgressionCandidateProvenance }> = [];
  let occurrence = 0;
  const add = (kind: FavoriteProgression["kind"], raw: string, evidence: ProgressionEvidence["evidence"], source: ProgressionEvidence["source"], extra: Partial<ProgressionEvidence> = {}, location: { segment?: string; segmentIndex?: number } = {}) => {
    const number = numberValue(raw);
    if (!Number.isFinite(number) || number < 0) return;
    const candidate: ProgressionCandidateProvenance = { kind, raw, number, source, evidence, occurrence: occurrence++, ...location };
    candidates.push({ kind, number, raw, season: input.source?.season, localNumber: kind === "episode" ? number : undefined, candidate, provenance: { source, evidence, inputTitle: input.title, inputUrl: input.url, parsedTitle, slug: input.source?.slug, pathSegments, releaseSuffix: input.source?.releaseSuffix, urlSeason: input.source?.season, localNumber: kind === "episode" ? number : undefined, candidates: [], rejectedCandidates: [], parserVersion: FAVORITE_PROGRESS_PARSER_VERSION, ...extra } });
  };

  for (const match of input.title.matchAll(marker)) add(kindFor(match[1]), match[2], "explicit-marker", "bookmark-title");
  for (const [segmentIndex, segment] of [...pathSegments, input.source?.releaseSuffix ?? ""].entries())
    for (const match of segment.matchAll(marker)) add(kindFor(match[1]), match[2], "labelled-url-path", "url-path", {}, { segment, segmentIndex });
  for (const match of input.title.matchAll(/(?:^|\s[-–—|·:]\s)(\d+(?:[.,]\d+)?)(?:\s+(vostfr|vf|vo|sub|dub|scan|scans))(?=\s*(?:[-–—|·:]|$))/giu)) add(input.source?.type === "ANIME" ? "episode" : "chapter", match[1], "separated-release", "bookmark-title");

  const aliases = input.source ? [...new Set([input.source.title, ...(input.source.aliases ?? [])].filter(Boolean))] : [];
  if (input.source && aliases.length) {
    const titleSeasonMatch = input.title.match(seasonMarker);
    const titleSeason = titleSeasonMatch ? Number(titleSeasonMatch[1]) : undefined;
    const withoutSeason = input.title.replace(seasonMarker, " ").replace(/\s*[-–—|·:]\s*$/u, " ").trim();
    const barePatterns = [
      /^(\d+(?:[.,]\d+)?)\s*[-–—|·:]?\s+(.+)$/u,
      /^(.+?)\s*[-–—|·:]\s*(\d+(?:[.,]\d+)?)$/u,
      /^(.+?)\s+(\d+(?:[.,]\d+)?)$/u,
    ];
    for (const pattern of barePatterns) {
      const match = withoutSeason.match(pattern);
      if (!match) continue;
      const numberFirst = /^\d/u.test(match[1]);
      const raw = numberFirst ? match[1] : match[2];
      const identityPart = numberFirst ? match[2] : match[1];
      // Ordinals remain identity text and never become a release position.
      if (/\d+(?:st|nd|rd|th|er|e|ème)$/iu.test(raw)) continue;
      const proof = matchValidatedTitle(identityPart, aliases);
      if (!proof) continue;
      add(input.source.type === "ANIME" ? "episode" : "chapter", raw, titleSeason !== undefined && input.source.season !== undefined && titleSeason !== input.source.season ? "season-divergence" : "bare-number-after-validated-identity", "bookmark-title", { matchedAlias: proof.alias, matchMethod: proof.method, titleSeason });
      break;
    }
    const identity = matchValidatedTitle(parsedTitle ?? input.title, aliases) ?? matchValidatedTitle(withoutSeason, aliases);
    // A bare URL number is admissible only as the complete terminal path
    // segment. Numbers embedded in title slugs, years and routing IDs are not
    // progression evidence.
    const terminalSegment = pathSegments.at(-1);
    const terminalIsProvedSeason = input.source.season !== undefined && Number(terminalSegment) === input.source.season && /^(?:season|saison|s)$/iu.test(pathSegments.at(-2) ?? "");
    if (identity && terminalSegment && !terminalIsProvedSeason && /^\d+(?:[.,]\d+)?$/u.test(terminalSegment))
      add(input.source.type === "ANIME" ? "episode" : "chapter", terminalSegment, "numeric-url-segment-after-source-identity", "url-path", { matchedAlias: identity.alias, matchMethod: identity.method, titleSeason }, { segment: terminalSegment, segmentIndex: pathSegments.length - 1 });
  }

  if (!candidates.length) return null;
  const priority = (candidate: FavoriteProgression) => candidate.provenance.evidence === "explicit-marker" ? 5 : candidate.provenance.evidence === "labelled-url-path" ? 4 : candidate.provenance.evidence === "separated-release" ? 3 : candidate.provenance.evidence === "season-divergence" ? 2 : 1;
  // Quality is authoritative; position only breaks ties within the same
  // evidence class. Numeric magnitude never establishes progression.
  const selected = [...candidates].sort((left, right) => priority(right) - priority(left) || right.candidate.occurrence - left.candidate.occurrence)[0]!;
  const hasExplicitEvidence = candidates.some(candidate => candidate.provenance.evidence === "explicit-marker" || candidate.provenance.evidence === "labelled-url-path");
  const rejectedCandidates: ProgressionRejectedCandidate[] = candidates
    .filter(candidate => candidate !== selected)
    .map(candidate => ({
      ...candidate.candidate,
      reason: candidate.kind !== selected.kind
        ? "INCOMPATIBLE_KIND"
        : hasExplicitEvidence && candidate.provenance.evidence !== "explicit-marker" && candidate.provenance.evidence !== "labelled-url-path"
          ? "EXPLICIT_EVIDENCE_PRESENT"
          : priority(candidate) < priority(selected)
            ? "LOWER_QUALITY_EVIDENCE"
            : "EARLIER_SAME_QUALITY_EVIDENCE",
    }));
  selected.provenance.candidates = candidates.map(candidate => candidate.candidate);
  selected.provenance.rejectedCandidates = rejectedCandidates;
  const { candidate: _candidate, ...result } = selected;
  return result;
}
