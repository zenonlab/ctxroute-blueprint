import { createHash } from "node:crypto";
import { CONNECTOR_VERSIONS } from "@favlib/config";
import { normalizeSerializationStatus } from "@favlib/progression";
import type { Task } from "graphile-worker";
import {
  fetchAniList,
  cleanDisplayTitle,
  decideAniListTitleMatch,
  exactAniListMediaMatches,
  exactTitleMatchKind,
  explicitTitleAliases,
  aniListExplicitSeasonMatch,
  matchAniList,
  aniListFormatAllowed,
  hasExplicitOvaMarker,
  normalizeTitle,
  searchAniList,
  titleVariants,
  type AniListMedia,
} from "@favlib/metadata";
import { aniListHooks } from "../anilist-gate.js";
import { saveCover } from "../cover-store.js";
import {
  claimEnrichment,
  ENRICHMENT_VERSION,
  enrichmentFingerprint,
  finishEnrichment,
  normalizedError,
  isProtectedResolvedLinkError,
  retryableProviderError,
} from "../enrichment-state.js";
import { operationalValue } from "../settings.js";
import { markFavoriteMatched, markFavoriteUnresolved, reconcileResolvedFavoriteReviews } from "../favorite-resolution.js";
import { openReviewsForMedia } from "../favorite-review.js";
import { saveProviderProfileCover } from "../cover-store.js";
import { recordAndReconcileAnimeWork } from './anime-work.js';

type Helpers = {
  query: (sql: string, values?: unknown[]) => Promise<any>;
  logger: { warn: (message: string) => void };
};
function trace(h: Helpers, event: string, data: Record<string, unknown>) {
  const message = `[provider-trace] ${JSON.stringify({ event, provider: "anilist", ...data })}`;
  const logger = h.logger as typeof h.logger & { info?: (value: string) => void };
  if (event.includes("error") || data.status === "ERROR") h.logger.warn(message);
  else if (logger.info) logger.info(message);
  else h.logger.warn(message);
}
async function providerRequest<T>(
  h: Helpers,
  operation: string,
  input: Record<string, unknown>,
  request: () => Promise<T>,
): Promise<T> {
  trace(h, "provider_exchange_input", { provider: "anilist", operation, input });
  try {
    const output = await request();
    trace(h, "provider_exchange_output", { provider: "anilist", operation, input, output });
    return output;
  } catch (error) {
    trace(h, "provider_exchange_error", {
      provider: "anilist", operation, input, error: normalizedError(error),
    });
    throw error;
  }
}
function titleOf(m: AniListMedia) {
  return (
    m.title.userPreferred ??
    m.title.english ??
    m.title.romaji ??
    m.title.native ??
    m.synonyms[0] ??
    `AniList ${m.id}`
  );
}
export function serializeCandidateSnapshot(items: AniListMedia[]) {
  return JSON.stringify(items);
}

function candidateTitles(media: AniListMedia) {
  return [
    media.title.english,
    media.title.romaji,
    media.title.userPreferred,
    media.title.native,
    ...media.synonyms,
  ].filter((value): value is string => Boolean(value?.trim()));
}

/**
 * Builds provider queries without changing the source/parser aliases stored in
 * the catalogue. Result titles are intentionally included so a poor first
 * AniList result can lead to a useful romaji/English follow-up query.
 */
export function anilistProviderVariants(values: string[]) {
  const queryValues = [...values];
  for (const value of values) {
    const cleaned = value
      .replace(
        /\s*[-–—]\s*(?:\d+\s*)?(?:vostfr|vf|vo|dub|sub)\b.*$/iu,
        "",
      )
      .replace(/\s*\((?:vf|vo|vostfr|dub|sub|saison\s*\d+)\)\s*$/iu, "")
      .replace(/\s+(?:vostfr|vf|vo|dub|sub)\s*$/iu, "")
      .replace(/\s+(?:s\d+|season\s*\d+|saison\s*\d+)\s*$/iu, "")
      .replace(/\s+\d+\s*$/u, "")
      .trim();
    if (cleaned && cleaned !== value) queryValues.push(cleaned);
    for (const piece of value.split(/\s+[-–—]\s+/u)) {
      const segment = piece
        .replace(/\s*\((?:vf|vo|vostfr|dub|sub|saison\s*\d+)\)\s*$/iu, "")
        .replace(/\s+(?:vostfr|vf|vo|dub|sub)\s*$/iu, "")
        .trim();
      if (segment && segment !== value) queryValues.push(segment);
    }
  }
  const variants = new Set(
    titleVariants(queryValues).filter((item) => item.length > 2),
  );
  for (const value of [...variants]) {
    const tokens = value.split(" ");
    if (tokens.length <= 6) continue;
    for (let end = 4; end <= Math.min(8, tokens.length); end++)
      variants.add(tokens.slice(0, end).join(" "));
  }
  for (const value of [...variants]) {
    const tokens = value.split(" ");
    for (const [index, token] of tokens.entries()) {
      let singular: string | undefined;
      if (/[^s]ies$/iu.test(token) && token.length > 4)
        singular = `${token.slice(0, -3)}y`;
      else if (/(?<!s)s$/iu.test(token) && token.length > 4)
        singular = token.slice(0, -1);
      if (!singular || singular === token) continue;
      const alternate = [...tokens];
      alternate[index] = singular;
      variants.add(alternate.join(" "));
    }
  }
  return [...variants];
}

/**
 * A bounded provider-native fallback: search only the most informative title
 * token(s), then rank the returned candidates against the complete aliases.
 * This is deliberately not a cartesian product of token combinations.
 */
export function anilistAnchorVariants(values: string[]) {
  const anchors = new Set<string>();
  for (const value of values) {
    const tokens = normalizeTitle(value).split(" ")
      .filter((token) => token.length >= 2 && !/^(?:the|this|that|with|from|into|your|once|episode|chapter|vostfr|saison)$/u.test(token));
    // Adjacent phrases retain much more identity than isolated keywords while
    // still recovering provider titles that omit a translated subtitle.
    for (const size of [4, 3, 2]) {
      for (let start = 0; start + size <= tokens.length; start++) {
        const phrase = tokens.slice(start, start + size).join(" ");
        if (phrase.length >= 6) anchors.add(phrase);
      }
    }
    const informative = [...tokens].filter((token) => token.length >= 4)
      .sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
    if (informative) anchors.add(informative);
  }
  return [...anchors].slice(0, 12);
}

async function assertion(
  h: Helpers,
  mediaId: string,
  field: string,
  value: unknown,
  source: string,
  confidence: number,
) {
  if (value === undefined || value === null) return;
  await h.query(
    "INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence,attribution) VALUES($1,$2,$3,'anilist',$4,$5,'AniList') ON CONFLICT(media_id,field,provider,source_url) DO UPDATE SET value=excluded.value,confidence=excluded.confidence,attribution=excluded.attribution,asserted_at=now()",
    [mediaId, field, JSON.stringify(value), source, confidence],
  );
}
function payloadHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function titleScript(value: string) {
  if (/[\u3040-\u30ff\u4e00-\u9fff]/u.test(value)) return "Jpan";
  if (/[\uac00-\ud7af]/u.test(value)) return "Kore";
  if (/[\u0400-\u04ff]/u.test(value)) return "Cyrl";
  return "Latn";
}
async function persist(
  h: Helpers,
  mediaId: string,
  m: AniListMedia,
  match?: { displayTitle?: string },
  discoverAnimeWork = true,
) {
  const source =
    m.siteUrl ?? `https://anilist.co/${m.type.toLowerCase()}/${m.id}`;
  const existing = await h.query(
    "SELECT media_id FROM media_external_id WHERE provider='anilist' AND external_id=$1",
    [String(m.id)],
  );
  // Provider identities are shared catalogue entities: if another favorite
  // already resolved to this AniList id, enrich that same media and move the
  // current bookmark link to it instead of creating a duplicate.
  const target = existing.rows[0]?.media_id ?? `anilist:${m.id}`;
  await h.query(
    "INSERT INTO media(id,type,season_year,country_of_origin,format) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO UPDATE SET type=excluded.type,season_year=COALESCE(excluded.season_year,media.season_year),country_of_origin=COALESCE(excluded.country_of_origin,media.country_of_origin),format=COALESCE(excluded.format,media.format),updated_at=now()",
    [
      target,
      m.type,
      m.seasonYear ?? m.startYear ?? null,
      m.countryOfOrigin ?? null,
      m.format ?? null,
    ],
  );
  if (target !== mediaId) {
    const sourceIdentity = await h.query(
      "SELECT external_id FROM media_external_id WHERE media_id=$1 AND provider='anilist' LIMIT 1",
      [mediaId],
    );
    if (sourceIdentity.rowCount && String(sourceIdentity.rows[0].external_id) !== String(m.id))
      throw new Error("ANILIST_IDENTITY_CONFLICT");
    await h.query("SELECT merge_media_identity($1,$2,'anilist',$3,$4::jsonb)", [mediaId, target, String(m.id), JSON.stringify({source:'anilist-provider-id',externalId:m.id})]);
  }
  const collectedAt = new Date();
  const hash = payloadHash(m);
  await h.query(
    "UPDATE provider_payload SET is_current=false WHERE media_id=$1 AND provider='anilist' AND connector_version=$2 AND payload_hash<>$3",
    [target, ENRICHMENT_VERSION, hash],
  );
  await h.query(
    "INSERT INTO provider_payload(media_id,provider,connector_version,collected_at,payload_hash,payload,provenance,validity_status,is_current) VALUES($1,'anilist',$2,$3,$4,$5,$6,'VALID',true) ON CONFLICT(media_id,provider,connector_version,payload_hash) DO UPDATE SET is_current=true",
    [
      target,
      ENRICHMENT_VERSION,
      collectedAt,
      hash,
      JSON.stringify(m),
      JSON.stringify({
        source,
        externalId: m.id,
        connectorVersion: ENRICHMENT_VERSION,
      }),
    ],
  );
  await h.query(
    "INSERT INTO provider_sync_state(media_id,provider,connector_version,last_payload_hash,last_collected_at,last_success_at,status,attempt_count,error,updated_at) VALUES($1,'anilist',$2,$3,$4,$4,'SUCCESS',1,NULL,now()) ON CONFLICT(media_id,provider,connector_version) DO UPDATE SET last_payload_hash=excluded.last_payload_hash,last_collected_at=excluded.last_collected_at,last_success_at=excluded.last_success_at,status='SUCCESS',attempt_count=provider_sync_state.attempt_count+1,error=NULL,updated_at=now()",
    [target, ENRICHMENT_VERSION, hash, collectedAt],
  );
  const titleRows: [string, string, string, string, string | null][] = [
    [
      m.title.userPreferred ?? "",
      "und",
      titleScript(m.title.userPreferred ?? ""),
      "official",
      "userPreferred",
    ],
    [m.title.english ?? "", "en", "Latn", "translation", "english"],
    [m.title.romaji ?? "", "und", "Latn", "romaji", "romaji"],
    [
      m.title.native ?? "",
      m.countryOfOrigin === "JP"
        ? "ja"
        : m.countryOfOrigin === "KR"
          ? "ko"
          : "und",
      titleScript(m.title.native ?? ""),
      "native",
      "native",
    ],
    ...m.synonyms.map(
      (title) =>
        [title, "und", titleScript(title), "synonym", "synonym"] as [
          string,
          string,
          string,
          string,
          string,
        ],
    ),
  ];
  for (const [title, language, script, titleType, field] of titleRows) {
    if (!title) continue;
    await h.query(
      "INSERT INTO media_title(media_id,text,normalized_text,language,script,kind,title_type,personal_status,connector,confidence,provenance) VALUES($1,$2,$3,$4,$5,$6,$6,NULL,'anilist',$7,$8) ON CONFLICT DO NOTHING",
      [
        target,
        title,
        normalizeTitle(title),
        language,
        script,
        titleType,
        1,
        { provider: "anilist", externalId: m.id, field },
      ],
    );
    await h.query(
      "UPDATE media_title SET language=$3,script=$4,kind=$5,title_type=$5,confidence=1,provenance=provenance||$6 WHERE media_id=$1 AND text=$2 AND connector='anilist' AND provenance->>'externalId'=$7 AND provenance->>'field'=$8",
      [target,title,language,script,titleType,{provider:'anilist',externalId:m.id,field},String(m.id),field],
    );
  }
  // The provider identity, never the search result's displayTitle, owns the
  // title shown to users. Search/matching labels remain provenance only.
  const canonical = cleanDisplayTitle(titleOf(m)) ?? titleOf(m).trim();
  await h.query(
    "UPDATE media_title SET text=$2,normalized_text=$3,language='en',script='Latn',confidence=1,provenance=provenance || $4::jsonb WHERE media_id=$1 AND kind='official' AND title_type='canonical' AND connector='anilist' AND provenance->>'externalId'=$5",
    [target, canonical, normalizeTitle(canonical), JSON.stringify({ provider: "anilist", externalId: m.id, canonical: true }), String(m.id)],
  );
  const canonicalExists = await h.query(
    "SELECT 1 FROM media_title WHERE media_id=$1 AND kind='official' AND title_type='canonical' AND connector='anilist' AND provenance->>'externalId'=$2 LIMIT 1",
    [target, String(m.id)],
  );
  if (!canonicalExists.rows[0])
    await h.query(
      "INSERT INTO media_title(media_id,text,normalized_text,language,script,kind,title_type,personal_status,connector,confidence,provenance) VALUES($1,$2,$3,'en','Latn','official','canonical',NULL,'anilist',1,$4) ON CONFLICT DO NOTHING",
      [target, canonical, normalizeTitle(canonical), { provider: "anilist", externalId: m.id, canonical: true }],
    );
  await h.query(
    "UPDATE media_title personal SET personal_status=CASE WHEN EXISTS(SELECT 1 FROM media_title supplier WHERE supplier.media_id=personal.media_id AND supplier.connector IN ('anilist','mangaupdates') AND supplier.normalized_text=personal.normalized_text) THEN 'CORROBORATED' ELSE 'PERSONAL_ONLY' END WHERE personal.media_id=$1 AND personal.kind='personal'",
    [target],
  );
  await h.query(
    "INSERT INTO media_external_id(media_id,provider,external_id,provenance) VALUES($1,'anilist',$2,$3) ON CONFLICT(provider,external_id) DO NOTHING",
    [target, String(m.id), { sourceUrl: source }],
  );
  for (const external of m.externalLinks ?? []) {
    if (!external.site || !external.url) continue;
    const provider = `anilist:${external.site
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .slice(0, 80)}`;
    await h.query(
      "INSERT INTO media_external_id(media_id,provider,external_id,provenance) VALUES($1,$2,$3,$4) ON CONFLICT(provider,external_id) DO NOTHING",
      [
        target,
        provider,
        external.url,
        { provider: "anilist", anilistId: m.id, source },
      ],
    );
  }
  if (m.idMal)
    await h.query(
      "INSERT INTO media_external_id(media_id,provider,external_id,provenance) VALUES($1,'mal',$2,$3) ON CONFLICT(provider,external_id) DO NOTHING",
      [
        target,
        String(m.idMal),
        { provider: "anilist", anilistId: m.id, source },
      ],
    );
  // Relations remain in the favorite work's provider assertion below. They
  // are descriptive cache data, not independent catalog membership.
  await h.query(
    "UPDATE bookmark_media_link l SET media_id=$1,status='review',evidence=$2 WHERE l.media_id=$3 AND l.status IN ('matched','review','accepted') AND NOT EXISTS(SELECT 1 FROM favorite_review r WHERE r.user_id=l.user_id AND r.installation_id=l.installation_id AND r.bookmark_id=l.bookmark_id AND r.status='RESOLVED' AND r.decision IS NOT NULL)",
    [target, { provider: "anilist", externalId: m.id }, mediaId],
  );
  const themes = [
    ...new Set([
      ...m.genres,
      ...m.tags.filter((tag) => !tag.isMediaSpoiler).map((tag) => tag.name),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  const categories = [
    ...new Set(
      m.tags
        .filter((tag) => !tag.isMediaSpoiler)
        .map((tag) => tag.name.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const adultCategories = [
    ...new Set(
      m.tags
        .filter((tag) => !tag.isMediaSpoiler && tag.isAdult)
        .map((tag) => tag.name.trim())
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b));
  const values: [string, unknown][] = [
    ["themes", themes],
    ["genres", m.genres],
    ["categories", categories],
    ["adultCategories", adultCategories],
    ["tags", m.tags],
    ["status", m.status],
    ["startDate", m.startDate],
    ["authors", m.authors],
    ["endDate", m.endDate],
    ["year", m.startYear],
    ["season", m.season],
    ["seasonYear", m.seasonYear],
    ["seasonInt", m.seasonInt],
    ["format", m.format],
    ["language", m.countryOfOrigin],
    ["description", m.description],
    ["coverImage", m.coverImage],
    ["bannerImage", m.bannerImage],
    ["coverColor", m.color],
    ["duration", m.duration],
    ["averageScore", m.averageScore],
    ["meanScore", m.meanScore],
    ["popularity", m.popularity],
    ["trending", m.trending],
    ["favourites", m.favourites],
    ["isAdult", m.isAdult],
    ["isLicensed", m.isLicensed],
    ["isLocked", m.isLocked],
    ["source", m.source],
    ["hashtag", m.hashtag],
    ["updatedAt", m.updatedAt],
    ["episodes", m.episodes],
    ["chapters", m.chapters],
    ["volumes", m.volumes],
    ["studios", m.studios],
    ["streamingEpisodes", m.streamingEpisodes],
    ["nextAiringEpisode", m.nextAiringEpisode],
    ["airingSchedule", m.airingSchedule],
    ["relations", m.relations],
  ];
  for (const [field, value] of values)
    await assertion(h, target, field, value, source, 1);
  const normalizedStatus = normalizeSerializationStatus(m.status);
  const aired = (m.airingSchedule ?? []).filter(x => x.episode && x.airingAt && x.airingAt * 1000 <= Date.now()).map(x => x.episode!);
  const available = normalizedStatus === 'Completed' && m.episodes ? m.episodes : aired.length ? Math.max(...aired) : undefined;
  await h.query(`INSERT INTO provider_progress(media_id,provider,serialization_status,available_position_kind,available_position_number,available_position_raw,available_position_provenance,last_checked_at,status,last_error,provenance,updated_at) VALUES($1,'anilist',$2,$3,$4,$5,$6,now(),'ACTIVE',NULL,$7,now()) ON CONFLICT(media_id,provider) DO UPDATE SET serialization_status=COALESCE(excluded.serialization_status,provider_progress.serialization_status),available_position_kind=COALESCE(excluded.available_position_kind,provider_progress.available_position_kind),available_position_number=CASE WHEN excluded.available_position_number IS NULL OR provider_progress.available_position_number>excluded.available_position_number THEN provider_progress.available_position_number ELSE excluded.available_position_number END,available_position_raw=CASE WHEN excluded.available_position_number IS NOT NULL AND (provider_progress.available_position_number IS NULL OR excluded.available_position_number>=provider_progress.available_position_number) THEN excluded.available_position_raw ELSE provider_progress.available_position_raw END,available_position_provenance=CASE WHEN excluded.available_position_number IS NOT NULL AND (provider_progress.available_position_number IS NULL OR excluded.available_position_number>=provider_progress.available_position_number) THEN excluded.available_position_provenance ELSE provider_progress.available_position_provenance END,last_checked_at=now(),status='ACTIVE',last_error=NULL,provenance=provider_progress.provenance||excluded.provenance,updated_at=now()`,[target,normalizedStatus??null,available===undefined?null:'episode',available??null,available===undefined?null:String(available),available===undefined?null:{provider:'anilist',anilistId:m.id,evidence:normalizedStatus==='Completed'?'completed-total':'aired-schedule'},{provider:'anilist',anilistId:m.id,payloadHash:hash}]);
  if(discoverAnimeWork)await recordAndReconcileAnimeWork(h,target,m,hash);
  for (const airing of [
    ...(m.nextAiringEpisode ? [m.nextAiringEpisode] : []),
    ...(m.airingSchedule ?? []),
  ]) {
    if (!airing.airingAt || !airing.episode) continue;
    const at = new Date(airing.airingAt * 1000);
    const inserted = await h.query(
      "INSERT INTO media_airing(media_id,provider,episode,airing_at_utc,source_local_time,source_timezone,precision,schedule_status,last_verified_at,provenance) VALUES($1,'anilist',$2,$3,NULL,NULL,'INSTANT','SCHEDULED',now(),$4) ON CONFLICT(media_id,provider,episode) DO UPDATE SET airing_at_utc=excluded.airing_at_utc,last_verified_at=now(),schedule_status='SCHEDULED',provenance=excluded.provenance RETURNING id",
      [
        target,
        airing.episode,
        at,
        { provider: "anilist", anilistId: m.id, payloadHash: hash },
      ],
    );
    const airingId =
      inserted.rows[0]?.id ??
      (
        await h.query(
      "SELECT id FROM media_airing WHERE media_id=$1 AND provider='anilist' AND episode=$2::int",
          [target, airing.episode, at],
        )
      ).rows[0]?.id;
    if (airingId)
      await h.query(
          "INSERT INTO media_airing_observation(airing_id,payload_id,observed_at,payload_hash,airing_at_utc,provenance) VALUES($1,(SELECT id FROM provider_payload WHERE media_id=$2 AND provider='anilist' AND payload_hash=$3::text LIMIT 1),now(),$3::text,$4::timestamptz,$5::jsonb) ON CONFLICT(airing_id,payload_hash) DO NOTHING",
        [
          airingId,
          target,
          hash,
          at,
          { provider: "anilist", episode: airing.episode },
        ],
      );
  }
  await h.query(
    "INSERT INTO media_metadata(media_id,provider,external_id,source_url,status,resolved_at,updated_at) VALUES($1,'anilist',$2,$3,'ACTIVE',now(),now()) ON CONFLICT(media_id) DO UPDATE SET provider='anilist',external_id=excluded.external_id,source_url=excluded.source_url,status='ACTIVE',resolved_at=now(),updated_at=now()",
    [target, String(m.id), source],
  );
  await markFavoriteMatched(h.query, target);
  return { target, cover: m.coverImage };
}

export async function enrichAniList(payload: unknown, h: Helpers) {
  const mediaId = String((payload as any)?.mediaId ?? "");
  const forceRefresh = (payload as any)?.forceRefresh === true;
  const timeoutMs = await operationalValue(h, "timeouts.providerMs");
  const maxAttempts = await operationalValue(h, "metadata.maxAttempts");
  const row = await h.query(
    "SELECT m.type,COALESCE((SELECT json_agg(t.text ORDER BY CASE t.kind WHEN 'source' THEN 0 WHEN 'personal' THEN 1 ELSE 2 END,t.id) FROM media_title t WHERE t.media_id=m.id AND t.kind IN ('source','personal')),'[]') AS titles,COALESCE((SELECT json_agg(t.text ORDER BY t.id) FROM media_title t WHERE t.media_id=m.id AND t.kind='source'),'[]') AS source_titles,COALESCE((SELECT json_agg(t.text ORDER BY t.id DESC) FROM media_title t WHERE t.media_id=m.id AND t.kind='personal'),'[]') AS personal_titles,COALESCE((SELECT json_agg(t.provenance->>'sourceUrl') FROM media_title t WHERE t.media_id=m.id AND t.kind='source' AND t.provenance->>'sourceUrl' IS NOT NULL),'[]') AS source_urls,m.season_year AS year,(SELECT external_id FROM media_external_id WHERE media_id=m.id AND provider='anilist' LIMIT 1) AS anilist_id,EXISTS(SELECT 1 FROM favorite_review r JOIN favorite_review_candidate c ON c.review_id=r.id WHERE r.status='RESOLVED' AND r.selected_candidate_id=c.id AND r.provider='anilist' AND c.provider_id=(SELECT external_id FROM media_external_id WHERE media_id=m.id AND provider='anilist' LIMIT 1)) AS anilist_identity_user_selected FROM media m WHERE m.id=$1",
    [mediaId],
  );
  if (!row.rows[0]) return { status: "SKIPPED", reason: "MEDIA_NOT_FOUND" };
  const context = row.rows[0];
  if (context.type !== "ANIME")
    return { status: "SKIPPED", reason: "ANILIST_ANIME_ONLY" };
  const aliases = (
    Array.isArray(row.rows[0].titles) ? row.rows[0].titles : []
  )
    .filter(Boolean)
    .filter(
      (value: unknown) =>
        typeof value === "string" &&
        !/^manga\s+[a-z]{1,3}\d{4,}$/iu.test(value.trim()),
    );
  const parsedSourceAliases = (Array.isArray(context.source_titles) ? context.source_titles : []).filter((value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()));
  const identityAliases = explicitTitleAliases(parsedSourceAliases.length ? parsedSourceAliases : aliases);
  const formatEvidence = [...identityAliases, ...(Array.isArray(context.source_urls) ? context.source_urls : [])].filter((value): value is string => typeof value === 'string');
  const requiresOva = formatEvidence.some(hasExplicitOvaMarker);
  const fingerprint = enrichmentFingerprint({
    mediaId,
    aliases,
    type: context.type,
  });
  if (forceRefresh) {
    await h.query(
      "UPDATE media_enrichment_state SET invalidated_at=now(),next_attempt_at=NULL,updated_at=now() WHERE media_id=$1 AND provider='anilist' AND purpose='metadata'",
      [mediaId],
    );
  }
  const claim = await claimEnrichment(h, {
    mediaId,
    provider: "anilist",
    purpose: "metadata",
    version: ENRICHMENT_VERSION,
    fingerprint,
    maxAttempts,
  });
  if (!claim) return { status: "SKIPPED", reason: "STATE_NOT_DUE" };
  try {
    const knownId = Number(context.anilist_id);
    const known =
      Number.isInteger(knownId) && knownId > 0
        ? await providerRequest(h, "fetch-media", { id: knownId, source: "known-id" }, () => fetchAniList(knownId, { timeoutMs, hooks: aniListHooks(h) }))
        : null;
    const items: AniListMedia[] = [];
    const seenItems = new Set<number>();
    const remember = (candidateItems: AniListMedia[]) => {
      for (const item of candidateItems) {
        if (seenItems.has(item.id)) continue;
        seenItems.add(item.id);
        items.push(item);
      }
    };
    let selected: AniListMedia | undefined;
    let selectedResolutionCode = "NONE";
    const eligible: AniListMedia[] = [];
    if (known) {
      remember([known]);
      if (known.type !== "ANIME") {
        h.logger.warn(
          `[provider-reject] provider=anilist externalId=${known.id} type=${known.type} expected=ANIME source=known-id`,
        );
      } else {
        // A stored AniList ID is already the resolved identity. Enrichment is
        // a direct refresh and must not fall back to title search.
        selected = known;
        selectedResolutionCode = "KNOWN_EXTERNAL_ID";
      }
    }
    // Provider titles are observations, not source aliases. They may be shown
    // as candidates, but never become new search input.
    // Search identity-rich phrases first. Previously the long provider variant
    // list was sliced before anchors, silently dropping the discovery fallback.
    const pendingVariants = [...new Set([
      ...anilistAnchorVariants(aliases),
      ...anilistProviderVariants(aliases),
    ])].slice(0, 32);
    const observedVariants = new Set<string>();
    for (
      let variantIndex = 0;
      !selected && variantIndex < pendingVariants.length;
      variantIndex++
    ) {
      const alias = pendingVariants[variantIndex];
      const pages = await Promise.all([1, 2].map((page) => providerRequest(
        h, "search", { query: alias, page, perPage: 10, type: "ANIME" },
        () => searchAniList(alias, {
          timeoutMs, hooks: aniListHooks(h), type: "ANIME", page, perPage: 10,
        }),
      )));
      const candidates = pages.flat();
      remember(candidates);
      for (const candidate of candidates) {
        // A provider title is a bounded discovery hint only. It is never added
        // to `aliases`, never persisted as source/personal, and can therefore
        // help recall without becoming identity evidence by itself.
        if (pendingVariants.length < 48) {
          const observedTitles = candidateTitles(candidate);
          // Preserve one slot for every canonical field before expanding any
          // spelling variants; otherwise English variants can starve romaji,
          // native and synonym discovery.
          for (const title of observedTitles) {
            if (observedVariants.has(title) || pendingVariants.includes(title)) continue;
            observedVariants.add(title);
            pendingVariants.push(title);
            if (pendingVariants.length >= 48) break;
          }
          for (const title of observedTitles) {
            for (const variant of anilistProviderVariants([title])) {
              if (observedVariants.has(variant) || pendingVariants.includes(variant)) continue;
              observedVariants.add(variant);
              pendingVariants.push(variant);
              if (pendingVariants.length >= 48) break;
            }
            if (pendingVariants.length >= 48) break;
          }
        }
        if (candidate.type !== "ANIME") {
          h.logger.warn(
            `[provider-reject] provider=anilist externalId=${candidate.id} type=${candidate.type} expected=ANIME alias=${JSON.stringify(alias)}`,
          );
          continue;
        }
        if (aniListFormatAllowed(formatEvidence, candidate.format)) eligible.push(candidate);
      }
    }
    if (!selected) {
      const exact = exactAniListMediaMatches(identityAliases, eligible);
      const matchDecision = decideAniListTitleMatch(identityAliases, eligible);
      if (matchDecision.status === "MATCH") {
        selected = matchDecision.candidate;
        selectedResolutionCode = matchDecision.method?.toUpperCase().replaceAll("-", "_") ?? "TITLE_MATCH";
        await h.query("UPDATE bookmark_media_link SET evidence=evidence||$2::jsonb WHERE media_id=$1 AND status IN ('matched','accepted','review')", [mediaId, JSON.stringify({ resolution: selectedResolutionCode, matcherVersion: matchDecision.matcherVersion, matchedAlias: matchDecision.matchedAlias, providerTitle: matchDecision.providerTitle, rawProvenance: matchDecision.rawProvenance })]);
      }
    }
    await h.query(
      "UPDATE media_enrichment_state SET candidate_snapshot=$1::jsonb,updated_at=now() WHERE media_id=$2::text AND provider='anilist' AND purpose='metadata' AND connector_version=$3::text",
      [serializeCandidateSnapshot(items), mediaId, ENRICHMENT_VERSION],
    );
    const ambiguity = exactAniListMediaMatches(identityAliases, eligible).length > 1 && !selected;
    if (ambiguity || (!selected && items.length > 0)) {
      // Detail every displayed candidate before exposing it to the user.
      const exactItems = exactAniListMediaMatches(identityAliases, eligible);
      const tokens = (value: string) => new Set(normalizeTitle(value).split(' ').filter(token => token.length > 1 && !/^(?:the|this|that|with|from|into|your|once|episode|chapter|vostfr|saison)$/u.test(token)));
      const reviewItems = (exactItems.length ? exactItems : items).filter(item => item.type === 'ANIME' && aniListFormatAllowed(formatEvidence, item.format)).map(item=>({item,match:matchAniList({aliases: identityAliases,type:'ANIME'},[item])})).filter(({match})=>Boolean(match)).sort((a,b)=>(b.match?.score??0)-(a.match?.score??0)||a.item.id-b.item.id).map(({item})=>item).slice(0,5);
      const detailed = await Promise.all(reviewItems.map(async item => {
        try { return await providerRequest(h, "fetch-review-candidate", { id: item.id }, () => fetchAniList(item.id, { timeoutMs, hooks: aniListHooks(h) })); } catch { return item; }
      }));
      const titleRow = await h.query("SELECT t.text,t.provenance->>'sourceUrl' AS url FROM media_title t WHERE t.media_id=$1 AND t.kind='personal' ORDER BY t.id DESC LIMIT 1", [mediaId]);
      const sourceRow = await h.query("SELECT t.text,t.provenance->>'sourceUrl' AS url FROM media_title t WHERE t.media_id=$1 AND t.kind='source' ORDER BY CASE WHEN t.title_type='official' THEN 0 ELSE 1 END,t.id LIMIT 1", [mediaId]);
      const reason = items.some(item => item.type === 'ANIME') && !items.some(item => item.type === 'ANIME' && aniListFormatAllowed(formatEvidence, item.format)) ? 'FORMAT_MISMATCH' : items.every(item => item.type !== 'ANIME') ? 'TYPE_MISMATCH' : ambiguity ? 'AMBIGUOUS' : 'LOW_CONFIDENCE';
      await openReviewsForMedia(h.query, { title: sourceRow.rows[0]?.text ?? titleRow.rows[0]?.text ?? aliases[0], url: sourceRow.rows[0]?.url ?? titleRow.rows[0]?.url ?? '', provider: 'anilist', candidates: detailed.map(item => ({...item, id: String(item.id), title: titleOf(item)})), mediaId, reason, persistCover: (profileId, imageUrl, provider) => imageUrl ? saveProviderProfileCover(h, profileId, imageUrl, provider, { timeoutMs }) : Promise.resolve() });
      await h.query("UPDATE bookmark_media_link l SET status='review',evidence=evidence||jsonb_build_object('resolution','candidate-review','reason',$2::text) WHERE l.media_id=$1 AND l.status IN ('matched','accepted','review') AND NOT EXISTS(SELECT 1 FROM favorite_review r WHERE r.user_id=l.user_id AND r.installation_id=l.installation_id AND r.bookmark_id=l.bookmark_id AND r.status='RESOLVED' AND r.decision IS NOT NULL)", [mediaId, reason]);
      await finishEnrichment(h, { mediaId, provider: 'anilist', purpose: 'metadata', version: ENRICHMENT_VERSION, owner: claim.owner, status: 'NO_MATCH', errorCode: reason, resolutionCode: reason, });
      return { status: 'REVIEW', reason };
    }
    if (!selected) {
      const noResultReason = requiresOva ? 'OVA_REQUIRED_NOT_FOUND' : 'NO_RESULT';
      const status =
        claim.attempt_count >= maxAttempts ? "TERMINAL" : "NO_MATCH";
      await finishEnrichment(h, {
        mediaId,
        provider: "anilist",
        purpose: "metadata",
        version: ENRICHMENT_VERSION,
        owner: claim.owner,
        status,
        errorCode: noResultReason,
        resolutionCode: noResultReason,
      });
      await markFavoriteUnresolved(h.query, mediaId, noResultReason);
      return { status: "REVIEW", reason: noResultReason };
    }
    const complete =
      selected === known
        ? known
        : await providerRequest(h, "fetch-selected", { id: selected.id }, () => fetchAniList(selected.id, {
            timeoutMs, hooks: aniListHooks(h),
          }));
    if (complete.type !== "ANIME") throw new Error("ANILIST_WRONG_MEDIA_TYPE");
    trace(h, "anilist_match", {
      mediaId,
      externalId: complete.id,
      resolutionCode: selectedResolutionCode,
      sourceAliasCount: aliases.length,
    });
    const persisted = await persist(h, mediaId, complete, {
      displayTitle: titleOf(complete),
    },true);
    await reconcileResolvedFavoriteReviews(h.query, persisted.target);
    await finishEnrichment(h, {
      mediaId,
      provider: "anilist",
      purpose: "metadata",
      version: ENRICHMENT_VERSION,
      owner: claim.owner,
      status: "SUCCESS",
      externalId: String(complete.id),
      resolutionCode: selectedResolutionCode,
    });
    if (persisted.cover) {
      const existing = await h.query(
        "SELECT 1 FROM media_cover WHERE media_id=$1 AND status='ACTIVE' LIMIT 1",
        [persisted.target],
      );
      if (!existing.rows[0])
        try {
          await saveCover(
            h,
            persisted.target,
            persisted.cover,
            "anilist",
            "AniList",
            { timeoutMs, externalId: String(complete.id) },
          );
        } catch (error) {
          h.logger.warn(
            `AniList cover unavailable for ${persisted.target}: ${normalizedError(error)}`,
          );
        }
    }
    return {
      status: "SUCCESS",
      mediaId: persisted.target,
      externalId: complete.id,
    };
  } catch (error) {
    const code = normalizedError(error);
    if (isProtectedResolvedLinkError(code)) {
      h.logger.warn(`[resolved-link-protected] provider=anilist mediaId=${mediaId}`);
      return { status: "SKIPPED", reason: code };
    }
    await finishEnrichment(h, {
      mediaId,
      provider: "anilist",
      purpose: "metadata",
      version: ENRICHMENT_VERSION,
      owner: claim.owner,
      status: claim.attempt_count >= maxAttempts ? "TERMINAL" : "FAILED",
      errorCode: code,
      resolutionCode: code,
    });
    if (claim.attempt_count >= maxAttempts || code === "NO_RESULT" || code === "NO_MATCH")
      await markFavoriteUnresolved(h.query, mediaId, code);
    h.logger.warn(`AniList enrichment failed for ${mediaId}: ${code}`);
    return { status: "FAILED", reason: code };
  }
}

export async function enrichAniListCover(payload: unknown, h: Helpers) {
  const mediaId = String((payload as any)?.mediaId ?? "");
  const existing = await h.query(
    "SELECT 1 FROM media_cover WHERE media_id=$1 AND status='ACTIVE' LIMIT 1",
    [mediaId],
  );
  if (existing.rows[0])
    return { status: "SKIPPED", reason: "COVER_ALREADY_PRESENT" };
  const timeoutMs = await operationalValue(h, "timeouts.providerMs");
  const row = await h.query(
    "SELECT e.external_id AS anilist_id FROM media m JOIN media_external_id e ON e.media_id=m.id AND e.provider='anilist' WHERE m.id=$1 AND m.type='ANIME' LIMIT 1",
    [mediaId],
  );
  trace(h, "anilist_cover_lookup", {
    mediaId,
    found: Boolean(row.rows[0]),
    externalId: row.rows[0]?.anilist_id ?? null,
  });
  if (!row.rows[0])
    return { status: "SKIPPED", reason: "ANILIST_ID_NOT_FOUND" };
  const fingerprint = enrichmentFingerprint({
    mediaId,
    anilistId: row.rows[0].anilist_id,
  });
  const maxAttempts = await operationalValue(h, "metadata.maxAttempts");
  const claim = await claimEnrichment(h, {
    mediaId,
    provider: "anilist",
    purpose: "cover",
    version: CONNECTOR_VERSIONS.anilistCover,
    fingerprint,
    maxAttempts,
  });
  if (!claim) return { status: "SKIPPED", reason: "STATE_NOT_DUE" };
  try {
    trace(h, "anilist_cover_request", {
      mediaId,
      externalId: row.rows[0].anilist_id,
    });
    const item = await fetchAniList(Number(row.rows[0].anilist_id), {
      timeoutMs,
      hooks: aniListHooks(h),
    });
    const cover = item.coverImage;
    trace(h, "anilist_cover_response", {
      mediaId,
      externalId: item.id,
      hasCover: Boolean(cover),
      coverUrl: cover
        ? (() => {
            try {
              const u = new URL(cover);
              return `${u.origin}${u.pathname}`;
            } catch {
              return "[invalid-url]";
            }
          })()
        : null,
    });
    if (!cover) throw new Error("ANILIST_COVER_NOT_FOUND");
    await saveCover(h, mediaId, cover, "anilist", "AniList", {
      timeoutMs,
      externalId: String(item.id),
    });
    await finishEnrichment(h, {
      mediaId,
      provider: "anilist",
      purpose: "cover",
      version: CONNECTOR_VERSIONS.anilistCover,
      owner: claim.owner,
      status: "SUCCESS",
      externalId: String(row.rows[0].anilist_id),
      resolutionCode: "ANILIST_COVER",
    });
    return { status: "SUCCESS", mediaId, provider: "anilist" };
  } catch (error) {
    const code = normalizedError(error);
    const terminal = claim.attempt_count >= maxAttempts || !retryableProviderError(code);
    await finishEnrichment(h, {
      mediaId,
      provider: "anilist",
      purpose: "cover",
      version: CONNECTOR_VERSIONS.anilistCover,
      owner: claim.owner,
      status: terminal ? "TERMINAL" : "FAILED",
      errorCode: code,
      retrySeconds: terminal ? null : Math.min(86400, 300 * 2 ** Math.max(0, claim.attempt_count - 1)),
      resolutionCode: code,
    });
    h.logger.warn(`AniList cover failed for ${mediaId}: ${code}`);
    return { status: "FAILED", reason: code };
  }
}
const task: Task = async (payload, helpers) => {
  if ((payload as any)?.cover === true)
    await enrichAniListCover(payload, helpers as any);
  else await enrichAniList(payload, helpers as any);
};
export default task;
