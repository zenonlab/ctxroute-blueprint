import { createHash } from "node:crypto";
import type { Task } from "graphile-worker";
import {
  fetchAniList,
  matchAniList,
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
} from "../enrichment-state.js";
import { operationalValue } from "../settings.js";

type Helpers = {
  query: (sql: string, values?: unknown[]) => Promise<any>;
  logger: { warn: (message: string) => void };
};
function trace(h: Helpers, event: string, data: Record<string, unknown>) {
  h.logger.warn(
    `[provider-trace] ${JSON.stringify({ event, provider: "anilist", ...data })}`,
  );
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
  return JSON.stringify(
    items.slice(0, 10).map((x) => ({
      id: x.id,
      type: x.type,
      title: titleOf(x),
      year: x.startYear,
      format: x.format,
    })),
  );
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
    const tokens = normalizeTitle(value)
      .split(" ")
      .filter((token) => token.length >= 4 && !/^(?:the|this|that|with|from|into|your|once|life|man|girl|boy)$/u.test(token))
      .sort((a, b) => b.length - a.length);
    if (tokens[0]) anchors.add(tokens[0]);
  }
  return [...anchors].slice(0, 4);
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
) {
  const source =
    m.siteUrl ?? `https://anilist.co/${m.type.toLowerCase()}/${m.id}`;
  const existing = await h.query(
    "SELECT media_id FROM media_external_id WHERE provider='anilist' AND external_id=$1",
    [String(m.id)],
  );
  if (existing.rows[0]?.media_id && existing.rows[0].media_id !== mediaId)
    throw new Error("ANILIST_EXTERNAL_ID_CONFLICT");
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
  }
  if (match?.displayTitle)
    await h.query(
      "INSERT INTO media_title(media_id,text,normalized_text,language,script,kind,title_type,personal_status,connector,confidence,provenance) VALUES($1,$2,$3,'en','Latn','official','canonical',NULL,'anilist',$4,$5) ON CONFLICT DO NOTHING",
      [
        target,
        match.displayTitle,
        normalizeTitle(match.displayTitle),
        1,
        {
          provider: "anilist",
          externalId: m.id,
          canonical: true,
        },
      ],
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
    "UPDATE bookmark_media_link SET media_id=$1,status='matched',evidence=$2 WHERE media_id=$3 AND status IN ('matched','review','accepted')",
    [target, { provider: "anilist", externalId: m.id }, mediaId],
  );
  const themes = [
    ...new Set([
      ...m.genres,
      ...m.tags.filter((tag) => !tag.isMediaSpoiler).map((tag) => tag.name),
    ]),
  ].sort((a, b) => a.localeCompare(b));
  const values: [string, unknown][] = [
    ["themes", themes],
    ["genres", m.genres],
    ["tags", m.tags],
    ["status", m.status],
    ["startDate", m.startDate],
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
  for (const airing of [
    ...(m.nextAiringEpisode ? [m.nextAiringEpisode] : []),
    ...(m.airingSchedule ?? []),
  ]) {
    if (!airing.airingAt || !airing.episode) continue;
    const at = new Date(airing.airingAt * 1000);
    const inserted = await h.query(
      "INSERT INTO media_airing(media_id,provider,episode,airing_at_utc,source_local_time,source_timezone,precision,schedule_status,last_verified_at,provenance) VALUES($1,'anilist',$2,$3,NULL,NULL,'INSTANT','SCHEDULED',now(),$4) ON CONFLICT(media_id,provider,episode,airing_at_utc) DO UPDATE SET last_verified_at=now(),schedule_status='SCHEDULED',provenance=excluded.provenance RETURNING id",
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
          "SELECT id FROM media_airing WHERE media_id=$1 AND provider='anilist' AND episode=$2 AND airing_at_utc=$3",
          [target, airing.episode, at],
        )
      ).rows[0]?.id;
    if (airingId)
      await h.query(
        "INSERT INTO media_airing_observation(airing_id,payload_id,observed_at,payload_hash,airing_at_utc,provenance) VALUES($1,(SELECT id FROM provider_payload WHERE media_id=$2 AND provider='anilist' AND payload_hash=$3 LIMIT 1),now(),$3,$4,$5) ON CONFLICT(airing_id,payload_hash) DO NOTHING",
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
  return { target, cover: m.coverImage };
}

export async function enrichAniList(payload: unknown, h: Helpers) {
  const mediaId = String((payload as any)?.mediaId ?? "");
  const timeoutMs = await operationalValue(h, "timeouts.providerMs");
  const maxAttempts = await operationalValue(h, "metadata.maxAttempts");
  const row = await h.query(
    "SELECT m.type,COALESCE((SELECT json_agg(t.text ORDER BY CASE t.kind WHEN 'source' THEN 0 WHEN 'official' THEN 1 WHEN 'supplier' THEN 2 WHEN 'synonym' THEN 3 ELSE 4 END,t.id) FROM media_title t WHERE t.media_id=m.id),'[]') AS titles,m.season_year AS year,(SELECT external_id FROM media_external_id WHERE media_id=m.id AND provider='anilist' LIMIT 1) AS anilist_id FROM media m WHERE m.id=$1",
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
  const fingerprint = enrichmentFingerprint({
    mediaId,
    aliases,
    type: context.type,
  });
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
        ? await fetchAniList(knownId, { timeoutMs, hooks: aniListHooks(h) })
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
    const eligible: AniListMedia[] = [];
    if (known) {
      remember([known]);
      const owner = await h.query(
        "SELECT media_id FROM media_external_id WHERE provider='anilist' AND external_id=$1 LIMIT 1",
        [String(known.id)],
      );
      if (known.type !== "ANIME") {
        h.logger.warn(
          `[provider-reject] provider=anilist externalId=${known.id} type=${known.type} expected=ANIME source=known-id`,
        );
      } else if (owner.rows[0]?.media_id && owner.rows[0].media_id !== mediaId) {
        h.logger.warn(
          `[provider-collision] provider=anilist externalId=${known.id} existingMedia=${owner.rows[0].media_id} candidateMedia=${mediaId} source=known-id`,
        );
      } else selected = known;
    }
    const pendingVariants = [
      ...anilistProviderVariants([
      ...aliases,
      ...(known && known.type !== "ANIME" ? candidateTitles(known) : []),
      ]),
      ...anilistAnchorVariants(aliases),
    ];
    const queuedVariants = new Set(pendingVariants);
    for (
      let variantIndex = 0;
      !selected && variantIndex < pendingVariants.length;
      variantIndex++
    ) {
      const alias = pendingVariants[variantIndex];
      const candidates = await searchAniList(alias, {
        timeoutMs,
        hooks: aniListHooks(h),
        type: "ANIME",
      });
      remember(candidates);
      for (const candidate of candidates) {
        for (const title of candidateTitles(candidate)) {
          for (const variant of anilistProviderVariants([title])) {
            if (queuedVariants.has(variant) || pendingVariants.length >= 64)
              continue;
            queuedVariants.add(variant);
            pendingVariants.push(variant);
          }
        }
        if (candidate.type !== "ANIME") {
          h.logger.warn(
            `[provider-reject] provider=anilist externalId=${candidate.id} type=${candidate.type} expected=ANIME alias=${JSON.stringify(alias)}`,
          );
          continue;
        }
        const owner = await h.query(
          "SELECT media_id FROM media_external_id WHERE provider='anilist' AND external_id=$1 LIMIT 1",
          [String(candidate.id)],
        );
        if (owner.rows[0]?.media_id && owner.rows[0].media_id !== mediaId) {
          h.logger.warn(
            `[provider-collision] provider=anilist externalId=${candidate.id} existingMedia=${owner.rows[0].media_id} candidateMedia=${mediaId} alias=${JSON.stringify(alias)}`,
          );
          continue;
        }
        eligible.push(candidate);
      }
    }
    if (!selected)
      selected = matchAniList({ aliases, type: "ANIME" }, eligible)?.media ?? undefined;
    await h.query(
      "UPDATE media_enrichment_state SET candidate_snapshot=$1::jsonb,updated_at=now() WHERE media_id=$2 AND provider='anilist' AND purpose='metadata' AND connector_version=$3",
      [serializeCandidateSnapshot(items), mediaId, ENRICHMENT_VERSION],
    );
    if (!selected) {
      const status =
        claim.attempt_count >= maxAttempts ? "TERMINAL" : "NO_MATCH";
      await finishEnrichment(h, {
        mediaId,
        provider: "anilist",
        purpose: "metadata",
        version: ENRICHMENT_VERSION,
        owner: claim.owner,
        status,
        errorCode: "NO_RESULT",
        resolutionCode: "NO_RESULT",
      });
      return { status: "REVIEW", reason: "NO_RESULT" };
    }
    const complete =
      selected === known
        ? known
        : await fetchAniList(selected.id, {
            timeoutMs,
            hooks: aniListHooks(h),
          });
    if (complete.type !== "ANIME") throw new Error("ANILIST_WRONG_MEDIA_TYPE");
    const persisted = await persist(h, mediaId, complete, {
      displayTitle: titleOf(complete),
    });
    await finishEnrichment(h, {
      mediaId,
      provider: "anilist",
      purpose: "metadata",
      version: ENRICHMENT_VERSION,
      owner: claim.owner,
      status: "SUCCESS",
      externalId: String(complete.id),
      resolutionCode: "FIRST_RESULT",
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
    version: "anilist-cover-v4",
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
      version: "anilist-cover-v4",
      owner: claim.owner,
      status: "SUCCESS",
      externalId: String(row.rows[0].anilist_id),
      resolutionCode: "ANILIST_COVER",
    });
    return { status: "SUCCESS", mediaId, provider: "anilist" };
  } catch (error) {
    const code = normalizedError(error);
    await finishEnrichment(h, {
      mediaId,
      provider: "anilist",
      purpose: "cover",
      version: "anilist-cover-v4",
      owner: claim.owner,
      status: "FAILED",
      errorCode: code,
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
