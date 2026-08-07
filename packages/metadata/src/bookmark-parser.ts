export type BookmarkSourceEvidence = {
  title: string;
  type: "ANIME" | "MANGA" | "MANHWA" | "MANHUA" | string;
  slug?: string;
  releaseSuffix?: string;
  /** Aliases whose identity has already been established by FavLib. */
  aliases?: string[];
  /** Explicit season carried by a trusted URL adapter. */
  season?: number;
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
  parserVersion: number;
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
export const FAVORITE_PROGRESS_PARSER_VERSION = 2;

const noise = /^(?:vostfr|vf|vo|sub|dub|scan|scans|english|français|voiranime)$/iu;
const marker = /(chapter|chapitre|chap|ch|episode|épisode|ep|volume|vol)[-_.\s]*#?\s*(\d+(?:[.,]\d+)?)/giu;
const seasonMarker = /(?:season|saison)\s*(\d+)/iu;
const insignificant = new Set(["the", "a", "an", "of", "and", "et", "de", "la", "le", "les", "des", "episode", "chapter", "chapitre", "saison", "season", "vostfr", "vf", "vo", "sub", "dub"]);
const normalize = (value: string) => value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const compact = (value: string) => normalize(value).replace(/\s/gu, "");
const words = (value: string) => normalize(value).split(" ").filter((word) => word.length > 1 && !insignificant.has(word));
const numberValue = (raw: string) => Number(raw.replace(",", "."));
const kindFor = (label: string): FavoriteProgression["kind"] => /^vol/iu.test(label) ? "volume" : /^(?:ep|épisode)/iu.test(label) ? "episode" : "chapter";

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
  for (let pass = 0; pass < 5; pass++) {
    const before = title;
    title = title
      .replace(/\s+(?:chapter|chapitre|chap|ch|episode|épisode|ep|volume|vol)\s*#?\s*\d+(?:[.,]\d+)?(?:[-\w]+)?(?:\s+(?:online|free|vostfr|vf|vo|sub|dub|scan|scans).*)?$/iu, "")
      .replace(/\s+-\s+\d+(?:[.,]\d+)?(?:\s+(?:vostfr|vf|vo|sub|dub|scan|scans))?\s*$/iu, "")
      .replace(/\s+(?:in english online free|online free|en hd)\s*$/iu, "")
      .replace(/\s*(?:[-–—|·:]\s*)?(?:voiranime|mangakakalot|manganelo|manhwaz)(?:\.com)?\s*$/iu, "")
      .replace(/\s+(?:vostfr|vf|vo|sub|dub|scan|scans|en hd)\s*$/iu, "")
      .replace(/[|·:—–-]+$/u, "").trim();
    if (title === before) break;
  }
  const parts=title.split(/\s+-\s+/u).map((part)=>part.trim()).filter((part)=>part&&!noise.test(part)&&!/^\d+(?:[.,]\d+)?(?:\s+(?:vostfr|vf|vo|sub|dub|scan|scans))?$/iu.test(part));
  if(parts.length>1){const firstKey=compact(parts[0]);const duplicate=parts.slice(1).some((part)=>compact(part)===firstKey);if(duplicate)title=parts[0];}
  return title || null;
}

export function progressionFromFavorite(input: { title: string; url: string; source?: BookmarkSourceEvidence | null }): FavoriteProgression | null {
  const pathSegments = urlSegments(input.url);
  const parsedTitle = parseBookmarkTitle(input.title);
  const candidates: FavoriteProgression[] = [];
  const add = (kind: FavoriteProgression["kind"], raw: string, evidence: ProgressionEvidence["evidence"], source: ProgressionEvidence["source"], extra: Partial<ProgressionEvidence> = {}) => {
    const number = numberValue(raw);
    if (!Number.isFinite(number) || number < 0) return;
    candidates.push({ kind, number, raw, season: input.source?.season, localNumber: kind === "episode" ? number : undefined, provenance: { source, evidence, inputTitle: input.title, inputUrl: input.url, parsedTitle, slug: input.source?.slug, pathSegments, releaseSuffix: input.source?.releaseSuffix, urlSeason: input.source?.season, localNumber: kind === "episode" ? number : undefined, parserVersion: FAVORITE_PROGRESS_PARSER_VERSION, ...extra } });
  };

  for (const match of input.title.matchAll(marker)) add(kindFor(match[1]), match[2], "explicit-marker", "bookmark-title");
  for (const match of [...pathSegments, input.source?.releaseSuffix ?? ""].join("/").matchAll(marker)) add(kindFor(match[1]), match[2], "labelled-url-path", "url-path");
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
    if (identity) for (const [segmentIndex, segment] of pathSegments.entries()) {
      const isProvedSeasonSegment = input.source.season !== undefined && Number(segment) === input.source.season && /^(?:season|saison|s)$/iu.test(pathSegments[segmentIndex - 1] ?? "");
      if (isProvedSeasonSegment) continue;
      const matches = [...segment.matchAll(/(?:^|[-_.])(\d+(?:[.,]\d+)?)(?=$|[-_.])/gu)];
      for (const match of matches) add(input.source.type === "ANIME" ? "episode" : "chapter", match[1], "numeric-url-segment-after-source-identity", "url-path", { matchedAlias: identity.alias, matchMethod: identity.method, titleSeason });
      if (/^\d+(?:[.,]\d+)?$/u.test(segment)) add(input.source.type === "ANIME" ? "episode" : "chapter", segment, "numeric-url-segment-after-source-identity", "url-path", { matchedAlias: identity.alias, matchMethod: identity.method, titleSeason });
    }
  }

  if (!candidates.length) return null;
  const priority = (candidate: FavoriteProgression) => candidate.provenance.evidence === "explicit-marker" ? 5 : candidate.provenance.evidence === "season-divergence" ? 4 : candidate.provenance.evidence === "bare-number-after-validated-identity" ? 3 : candidate.provenance.evidence === "labelled-url-path" ? 2 : 1;
  const kind = [...candidates].sort((left, right) => priority(right) - priority(left))[0].kind;
  return candidates.filter((candidate) => candidate.kind === kind).sort((a, b) => b.number - a.number || priority(b) - priority(a))[0];
}
