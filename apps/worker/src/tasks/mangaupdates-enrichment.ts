import type { Task } from "graphile-worker";
import { createHash } from "node:crypto";
import { CONNECTOR_VERSIONS } from "@favlib/config";
import { normalizeSerializationStatus, position } from "@favlib/progression";
import { withProviderRequest } from "@favlib/database/provider-queue";
import {
  cleanDisplayTitle,
  explicitTitleAliases,
  fetchMangaUpdatesSeries,
  fetchMangaDexManga,
  parseMangaDexManga,
  decideMangaDexTitleMatch,
  mangaUpdatesMediaType,
  mangaUpdatesTypeAllowed,
  normalizeTitle,
  decideMangaUpdatesTitleMatch,
  rankMangaUpdatesReviewCandidates,
  resolveMangaUpdatesLinkedSeries,
  searchMangaUpdatesSeries,
  searchMangaDexManga,
  titleVariants,
} from "@favlib/metadata";
import { saveCover, saveProviderProfileCover } from "../cover-store.js";
import {
  claimEnrichment,
  blockProviderUntil,
  enrichmentFingerprint,
  finishEnrichment,
  normalizedError,
  isProtectedResolvedLinkError,
  retryableProviderError,
} from "../enrichment-state.js";
import { operationalValue } from "../settings.js";
import { markFavoriteMatched, markFavoriteUnresolved, reconcileResolvedFavoriteReviews } from "../favorite-resolution.js";
import { openReviewsForMedia } from "../favorite-review.js";
import { excludeFavoriteMediaByTaxonomy } from "../content-exclusion.js";

type Helpers = Parameters<Task>[1];
export const MANGAUPDATES_ENRICHMENT_VERSION = CONNECTOR_VERSIONS.mangaUpdatesMetadata;
const VERSION = MANGAUPDATES_ENRICHMENT_VERSION,
  COVER_VERSION = CONNECTOR_VERSIONS.mangaUpdatesCover;

/** MangaUpdates uses zero as an unknown-position sentinel. Keep the raw
 * provider value only when it proves a positive chapter. */
export function mangaUpdatesAvailableChapter(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const raw = String(value).trim();
  if (!raw) return undefined;
  const parsed = position(raw, "chapter");
  return parsed.number !== undefined && parsed.number > 0
    ? { raw, number: parsed.number }
    : undefined;
}
function snapshotCandidates(items: any[]) {
  return items;
}
function trace(h: any, event: string, data: Record<string, unknown>) {
  const message = `[provider-trace] ${JSON.stringify({ event, ...data })}`;
  if (event.includes("error") || data.status === "ERROR") h.logger.warn(message);
  else if (typeof h.logger.info === "function") h.logger.info(message);
  else h.logger.warn(message);
}
async function providerCall<T>(
  h: any,
  call: () => Promise<T>,
  context: Record<string, unknown> = {},
): Promise<T> {
  return withProviderRequest(h,{provider:'mangaupdates',kind:String(context.operation??context.kind??'metadata'),priority:70,scopeKey:typeof context.mediaId==='string'?context.mediaId:undefined,spacingMs:350},async()=>{
   trace(h, "provider_request", { provider: "mangaupdates", ...context });
   try {
    const result = await call();
    trace(h, "provider_response", {
      provider: "mangaupdates",
      input: context,
      output: result,
      status: "OK",
      resultSummary: Array.isArray(result)
        ? { count: result.length }
        : result && typeof result === "object"
          ? Object.keys(result as object)
          : typeof result,
      ...context,
    });
    return result;
  } catch (error) {
    trace(h, "provider_response", {
      provider: "mangaupdates",
      input: context,
      output: null,
      status: "ERROR",
      error: normalizedError(error),
      ...context,
    });
    throw error;
   }
  });
}
async function mangaDexCall<T>(h: any, call: () => Promise<T>, context: Record<string, unknown>): Promise<T> {
  return withProviderRequest(h, { provider: 'mangadex', kind: String(context.operation ?? 'identity-bridge'), priority: 60, scopeKey: typeof context.mediaId === 'string' ? context.mediaId : undefined, spacingMs: 1000 }, async () => {
    trace(h, 'provider_request', { provider: 'mangadex', ...context });
    try {
      const result = await call();
      trace(h, 'provider_response', { provider: 'mangadex', status: 'OK', resultSummary: Array.isArray(result) ? { count: result.length } : typeof result, ...context });
      return result;
    } catch (error) {
      const code = normalizedError(error);
      const retry = code.match(/^MANGADEX_HTTP_429_RETRY_(\d+)$/u);
      if (retry) await blockProviderUntil(h, 'mangadex', Date.now() + Math.min(86_400, Math.max(1, Number(retry[1]))) * 1000);
      trace(h, 'provider_response', { provider: 'mangadex', status: 'ERROR', error: normalizedError(error), ...context });
      throw error;
    }
  });
}
async function enrichCover(mediaId: string, h: any) {
  const existing = await h.query(
    "SELECT 1 FROM media_cover WHERE media_id=$1 AND status='ACTIVE' LIMIT 1",
    [mediaId],
  );
  if (existing.rows[0])
    return { status: "SKIPPED", reason: "COVER_ALREADY_PRESENT" };
  const timeoutMs = await operationalValue(h, "timeouts.providerMs"),
    maxAttempts = await operationalValue(h, "metadata.maxAttempts"),
    providerOptions = { timeoutMs };
  const row = await h.query(
    "SELECT m.type,COALESCE((SELECT json_agg(t.text ORDER BY CASE t.kind WHEN 'source' THEN 0 WHEN 'official' THEN 1 WHEN 'supplier' THEN 2 WHEN 'synonym' THEN 3 ELSE 4 END,t.id) FROM media_title t WHERE t.media_id=m.id),'[]') AS titles FROM media m WHERE m.id=$1 AND m.type IN ('MANGA','MANHWA','MANHUA')",
    [mediaId],
  );
  if (!row.rows[0])
    return { status: "SKIPPED", reason: "READING_MEDIA_NOT_FOUND" };
  const aliases = [
    ...(Array.isArray(row.rows[0].titles) ? row.rows[0].titles : []),
  ].filter(
    (value: any, index, array): value is string =>
      typeof value === "string" &&
      value.trim().length >= 3 &&
      /[\p{L}]{3}/u.test(value) &&
      array.indexOf(value) === index,
  );
  const fingerprint = enrichmentFingerprint({ mediaId, aliases });
  // The metadata upsert can be rejected by the provider/external-id uniqueness
  // guard when two provisional source records converge on the same series. The
  // identity row is still authoritative for the cover lane, so do not make
  // image production depend on the metadata projection being writable.
  const mu = await h.query(
    "SELECT external_id FROM media_metadata WHERE media_id=$1 AND provider='mangaupdates' AND status='ACTIVE' LIMIT 1",
    [mediaId],
  );
  const resolvedMu = mu.rows[0]?.external_id
    ? mu
    : await h.query(
        "SELECT external_id FROM media_external_id WHERE media_id=$1 AND provider='mangaupdates' ORDER BY external_id LIMIT 1",
        [mediaId],
      );
  if (!resolvedMu.rows[0]?.external_id)
    return { status: "SKIPPED", reason: "MANGAUPDATES_IDENTITY_REQUIRED" };
  const claim = await claimEnrichment(h, {
    mediaId,
    provider: "mangaupdates",
    purpose: "cover",
    version: COVER_VERSION,
    fingerprint,
    maxAttempts,
  });
  if (!claim) return { status: "SKIPPED", reason: "STATE_NOT_DUE" };
  try {
    const series = await providerCall(h, () =>
      fetchMangaUpdatesSeries(String(resolvedMu.rows[0].external_id), providerOptions),
      { operation: "fetch-cover-source", id: String(resolvedMu.rows[0].external_id) },
    );
    if (series.image) {
      await saveCover(h, mediaId, series.image, "mangaupdates", "MangaUpdates", {
        timeoutMs,
        externalId: String(resolvedMu.rows[0].external_id),
      });
      await finishEnrichment(h, {
        mediaId,
        provider: "mangaupdates",
        purpose: "cover",
        version: COVER_VERSION,
        owner: claim.owner,
        status: "SUCCESS",
        externalId: String(resolvedMu.rows[0].external_id),
        resolutionCode: "MANGAUPDATES_COVER",
      });
      return { status: "SUCCESS", mediaId, provider: "mangaupdates" };
    }
    // Manga/manhwa/manhua covers are owned by MangaUpdates. Never substitute
    // an unrelated AniList search result when MangaUpdates has no image.
    throw new Error("MANGAUPDATES_COVER_UNAVAILABLE");
  } catch (error) {
    const code = normalizedError(error);
    const terminal = claim.attempt_count >= maxAttempts || !retryableProviderError(code);
    await finishEnrichment(h, {
      mediaId,
      provider: "mangaupdates",
      purpose: "cover",
      version: COVER_VERSION,
      owner: claim.owner,
      status: terminal ? "TERMINAL" : "FAILED",
      errorCode: code,
      retrySeconds: terminal ? null : Math.min(86400, 300 * 2 ** Math.max(0, claim.attempt_count - 1)),
      resolutionCode: "COVER_UNAVAILABLE",
    });
    return { status: "FAILED", reason: code };
  }
}

const task: Task = async (raw, helpers: Helpers) => {
  const h = helpers as any,
    mediaId = String((raw as any)?.mediaId ?? ""),
    forceRefreshRequested = (raw as any)?.forceRefresh === true;
  let forceRefresh = forceRefreshRequested;
  if ((raw as any)?.cover === true) {
    await enrichCover(mediaId, h);
    return;
  }
  const timeoutMs = await operationalValue(h, "timeouts.providerMs"),
    maxAttempts = await operationalValue(h, "metadata.maxAttempts");
  const row = await h.query(
    "SELECT m.type,m.season_year AS year,m.country_of_origin AS country,m.format,COALESCE((SELECT json_agg(t.text ORDER BY CASE t.kind WHEN 'source' THEN 0 WHEN 'official' THEN 1 WHEN 'supplier' THEN 2 WHEN 'synonym' THEN 3 ELSE 4 END,t.id) FROM media_title t WHERE t.media_id=m.id),'[]') AS titles,COALESCE((SELECT json_agg(t.text ORDER BY t.id) FROM media_title t WHERE t.media_id=m.id AND t.kind='source'),'[]') AS source_titles,COALESCE((SELECT json_agg(t.text ORDER BY t.id DESC) FROM media_title t WHERE t.media_id=m.id AND t.kind='personal'),'[]') AS personal_titles,(SELECT external_id FROM media_metadata WHERE media_id=m.id AND provider='mangaupdates' AND status='ACTIVE' LIMIT 1) AS mangaupdates_id,(SELECT external_id FROM media_metadata WHERE media_id=m.id AND provider='mangadex' AND status='ACTIVE' LIMIT 1) AS mangadex_id,(SELECT payload FROM provider_payload WHERE media_id=m.id AND provider='mangadex' AND validity_status='VALID' AND is_current=true ORDER BY collected_at DESC LIMIT 1) AS mangadex_payload,EXISTS(SELECT 1 FROM favorite_review r JOIN favorite_review_candidate rc ON rc.review_id=r.id WHERE r.status='RESOLVED' AND r.selected_candidate_id=rc.id AND r.provider='mangaupdates' AND rc.provider_id=(SELECT external_id FROM media_metadata WHERE media_id=m.id AND provider='mangaupdates' AND status='ACTIVE' LIMIT 1)) AS mangaupdates_identity_user_selected FROM media m WHERE m.id=$1",
    [mediaId],
  );
  if (!row.rows[0]) return;
  const c = row.rows[0];
  const currentIdentity = await h.query(
    `SELECT identity.external_id,
      COALESCE((SELECT NULLIF(p.type,'UNKNOWN') FROM provider_profile p WHERE p.provider='mangaupdates' AND p.provider_id=identity.external_id ORDER BY p.last_seen_at DESC LIMIT 1),
        (SELECT payload.payload->>'type' FROM provider_payload payload WHERE payload.media_id=$1 AND payload.provider='mangaupdates' AND payload.is_current ORDER BY payload.collected_at DESC LIMIT 1)) AS raw_type
     FROM (SELECT COALESCE(
       (SELECT external_id FROM media_metadata WHERE media_id=$1 AND provider='mangaupdates' AND status='ACTIVE' LIMIT 1),
       (SELECT external_id FROM media_external_id WHERE media_id=$1 AND provider='mangaupdates' LIMIT 1)
     ) AS external_id) identity`,
    [mediaId],
  );
  c.mangaupdates_id ??= currentIdentity.rows[0]?.external_id;
  if (!["MANGA", "MANHWA", "MANHUA"].includes(c.type)) return;
  const alreadyResolved = await h.query(
    "SELECT 1 FROM media_metadata WHERE media_id=$1 AND provider='mangaupdates' AND status='ACTIVE' AND external_id IS NOT NULL LIMIT 1",
    [mediaId],
  );
  if (alreadyResolved.rows[0] && !forceRefresh) {
    const currentType = mangaUpdatesMediaType(currentIdentity.rows[0]?.raw_type);
    if (currentType) {
      await h.query("UPDATE media SET type=$2,updated_at=now() WHERE id=$1 AND type IN ('MANGA','MANHWA','MANHUA')",[mediaId,currentType]);
      await markFavoriteMatched(h.query, mediaId);
      await reconcileResolvedFavoriteReviews(h.query, mediaId);
      // Metadata may already be complete while the cover lane is missing or
      // stale. Never let the metadata fast-return permanently skip cover work.
      await enrichCover(mediaId, h);
      return;
    }
    forceRefresh = true;
  }
  const aliases = (Array.isArray(c.titles) ? c.titles : [])
    .filter(Boolean)
    .filter((value: unknown) =>
      typeof value === "string" &&
      !/^manga\s+[a-z]{1,3}\d{4,}$/iu.test(value.trim()),
    );
  const searchAliases = [...new Set((aliases as string[]).map((value: string) => cleanDisplayTitle(value) ?? value))];
  const parsedSourceAliases = (Array.isArray(c.source_titles) ? c.source_titles : []).filter((value: unknown): value is string => typeof value === 'string' && Boolean(value.trim()));
  const identityAliases = explicitTitleAliases(parsedSourceAliases.length ? parsedSourceAliases.map((value: string) => cleanDisplayTitle(value) ?? value) : searchAliases);
  const queries = titleVariants(searchAliases).filter((value) => value.length > 2);
  const fp = enrichmentFingerprint({ mediaId, type: c.type, aliases: searchAliases });
  if (forceRefresh) {
    await h.query(
      "UPDATE media_enrichment_state SET invalidated_at=now(),next_attempt_at=NULL,updated_at=now() WHERE media_id=$1 AND provider='mangaupdates' AND purpose='metadata'",
      [mediaId],
    );
  }
  const claim = await claimEnrichment(h, {
    mediaId,
    provider: "mangaupdates",
    purpose: "metadata",
    version: VERSION,
    fingerprint: fp,
    maxAttempts,
  });
  if (!claim) return;
  try {
    let candidates: any[] = [];
    let selected: any | undefined;
    let fastPath = false;
    let bridgeProvenance: Record<string, unknown> | undefined;
    const providerOptions = { timeoutMs };
    const knownMuId = c.mangaupdates_id
      ? String(c.mangaupdates_id)
      : "";
    if (knownMuId) {
      const record = await providerCall(h, () =>
        fetchMangaUpdatesSeries(knownMuId, providerOptions),
        { operation: "fetch-known", id: knownMuId },
      );
      candidates = [record];
      // A stored provider ID is already the resolved identity. Refresh it
      // directly and never reopen title discovery during enrichment.
      selected = record;
      fastPath = true;
    }
    if (!fastPath && forceRefresh && c.mangadex_id && c.mangadex_payload) {
      const storedMangaDex = parseMangaDexManga(c.mangadex_payload);
      if (storedMangaDex?.mangaUpdatesId) {
        const resolution = await providerCall(h, () => resolveMangaUpdatesLinkedSeries(storedMangaDex.mangaUpdatesId!, storedMangaDex.titles, providerOptions), { operation: 'resolve-stored-mangadex-link', mediaId, id: storedMangaDex.mangaUpdatesId });
        if (resolution?.series && mangaUpdatesTypeAllowed(resolution.series)) {
          selected = resolution.series;
          candidates = [resolution.series];
          fastPath = true;
          bridgeProvenance = { source: 'stored-mangadex-link', mangaDexId: storedMangaDex.id, linkedValue: resolution.rawLink, linkedValueKind: resolution.method, resolvedSeriesId: resolution.series.id, mangaUpdatesVersion: VERSION };
        }
      }
    }
    for (const q of fastPath ? [] : queries) {
      const results = await providerCall(h, () =>
        searchMangaUpdatesSeries(q, providerOptions),
        { operation: "search", query: q },
      );
      candidates.push(...results);
    }
    candidates = [...new Map(candidates.map((x) => [x.id, x])).values()];
    // Search responses are intentionally incomplete. Resolve every distinct hit
    // before scoring it, while retaining hit_title as an additional signal.
    const detailed: any[] = [];
    for (const candidate of fastPath ? [] : candidates) {
      try {
        const record = await providerCall(h, () =>
          fetchMangaUpdatesSeries(candidate.id, providerOptions),
          { operation: "fetch-candidate", id: candidate.id },
        );
        detailed.push({ ...record, hitTitle: candidate.hitTitle ?? candidate.title });
      } catch {
        // A single stale/dead result must not prevent other aliases/results.
        detailed.push(candidate);
      }
    }
    candidates = [...new Map((fastPath ? candidates : detailed).map((x) => [x.id, x])).values()];
    const matchAliases = identityAliases;
    const matchDecision = decideMangaUpdatesTitleMatch(matchAliases, candidates);
    if (matchDecision.status === 'NO_MATCH' && !knownMuId) {
      trace(h, 'bridge_attempt', { provider: 'mangadex', mediaId, queryCount: queries.length });
      try {
        const mangaDexCandidates: any[] = [];
        for (const query of queries) mangaDexCandidates.push(...await mangaDexCall(h, () => searchMangaDexManga(query, providerOptions), { operation: 'identity-bridge-search', mediaId, query }));
        const uniqueMangaDex = [...new Map(mangaDexCandidates.map(item => [item.id, item])).values()];
        const bridgeDecision = decideMangaDexTitleMatch(matchAliases, uniqueMangaDex);
        const mangaDexCandidate = bridgeDecision.candidate;
        if (bridgeDecision.status === 'MATCH' && mangaDexCandidate) {
          const mangaDex = await mangaDexCall(h, () => fetchMangaDexManga(mangaDexCandidate.id, providerOptions), { operation: 'identity-detail', mediaId, id: mangaDexCandidate.id });
          await excludeFavoriteMediaByTaxonomy(h.query, mediaId, 'mangadex', { categories: mangaDex.tags });
          let linked: any | undefined;
          if (mangaDex.mangaUpdatesId) try {
            const resolution = await providerCall(h, () => resolveMangaUpdatesLinkedSeries(mangaDex.mangaUpdatesId!, mangaDex.titles, providerOptions), { operation: 'resolve-bridged-link', mediaId, id: mangaDex.mangaUpdatesId });
            const fetched = resolution?.series;
            if (fetched && String(fetched.type ?? '').trim() && !mangaUpdatesTypeAllowed(fetched)) trace(h,'bridge_link_incompatible',{provider:'mangadex',mediaId,mangaDexId:mangaDex.id,mangaUpdatesLink:mangaDex.mangaUpdatesId,mangaUpdatesId:fetched.id});
            else if (fetched) {
              linked=fetched;
              bridgeProvenance = { linkedValue: resolution.rawLink, linkedValueKind: resolution.method, resolvedSeriesId: fetched.id };
            }
          } catch(error) {
            // A broken or temporarily unverifiable links.mu never invalidates
            // the independently unique MangaDex identity. Weekly promotion
            // will retry MangaUpdates without refreshing MangaDex metadata.
            trace(h,'bridge_link_unavailable',{provider:'mangadex',mediaId,mangaDexId:mangaDex.id,mangaUpdatesId:mangaDex.mangaUpdatesId,error:normalizedError(error)});
          }
          if (linked) {
          selected = linked;
          bridgeProvenance = {
            ...bridgeProvenance,
            source: 'mangadex-mangaupdates-bridge', mangaDexId: mangaDexCandidate.id,
            examinedTitles: uniqueMangaDex.map(item => ({ id: item.id, titles: item.titles, mangaUpdatesId: item.mangaUpdatesId })),
            matchedTitle: bridgeDecision.providerTitle, matchedAlias: bridgeDecision.matchedAlias,
            mangaUpdatesLink: mangaDex.mangaUpdatesId, mangaUpdatesId: linked.id, matcherMethod: bridgeDecision.method,
            matcherVersion: bridgeDecision.matcherVersion, mangaDexBridgeVersion: CONNECTOR_VERSIONS.mangaDexBridge,
            mangaUpdatesVersion: VERSION,
          };
          trace(h, 'bridge_match', { provider: 'mangadex', mediaId, mangaDexId: mangaDexCandidate.id, mangaUpdatesLink: mangaDex.mangaUpdatesId, mangaUpdatesId: linked.id });
          } else {
            const sourceUrl = `https://mangadex.org/title/${mangaDex.id}`;
            const payload = JSON.stringify(mangaDex.raw), payloadDigest = createHash('sha256').update(payload).digest('hex');
            await h.query("INSERT INTO media_external_id(media_id,provider,external_id,provenance) VALUES($1,'mangadex',$2,$3) ON CONFLICT(provider,external_id) DO NOTHING", [mediaId, mangaDex.id, { provider: 'mangadex', sourceUrl, matcherVersion: bridgeDecision.matcherVersion, rawProvenance: bridgeDecision.rawProvenance }]);
            await h.query("INSERT INTO provider_payload(media_id,provider,connector_version,payload_hash,payload,provenance,validity_status,is_current) VALUES($1,'mangadex',$2,$3,$4,$5,'VALID',true) ON CONFLICT(media_id,provider,connector_version,payload_hash) DO UPDATE SET is_current=true", [mediaId, CONNECTOR_VERSIONS.mangaDexBridge, payloadDigest, payload, { sourceUrl, externalId: mangaDex.id, collection: 'once' }]);
            for (const title of mangaDex.localizedTitles) await h.query("INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,connector,confidence,provenance) VALUES($1,$2,$3,$4,'supplier',$5,'mangadex',1,$6) ON CONFLICT DO NOTHING", [mediaId, title.text, normalizeTitle(title.text), title.language, title.kind === 'title' ? 'official' : 'associated', { provider: 'mangadex', externalId: mangaDex.id, raw: title.raw }]);
            // MangaDex may contribute identity and editorial metadata, but it
            // never contributes chapter/volume availability.
            const values: Array<[string, unknown]> = [['descriptions',mangaDex.descriptions],['description',mangaDex.descriptions],['genres',mangaDex.tags],['themes',mangaDex.tags],['status',mangaDex.status],['year',mangaDex.year],['language',mangaDex.originalLanguage],['authors',mangaDex.authors],['artists',mangaDex.artists],['relations',mangaDex.relations]];
            for (const [field,value] of values) if (value !== undefined && value !== null && (!Array.isArray(value) || value.length)) await h.query("INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence,attribution) VALUES($1,$2,$3,'mangadex',$4,1,'MangaDex') ON CONFLICT(media_id,field,provider,source_url) DO UPDATE SET value=excluded.value,asserted_at=now()", [mediaId,field,JSON.stringify(value),sourceUrl]);
            await h.query("INSERT INTO media_metadata(media_id,provider,external_id,source_url,latest_chapter,status,resolved_at,updated_at) VALUES($1,'mangadex',$2,$3,NULL,'ACTIVE',now(),now()) ON CONFLICT(media_id) DO UPDATE SET provider='mangadex',external_id=excluded.external_id,source_url=excluded.source_url,latest_chapter=NULL,status='ACTIVE',resolved_at=now(),updated_at=now()", [mediaId,mangaDex.id,sourceUrl]);
            await h.query("INSERT INTO mangadex_promotion_state(media_id,mangadex_id,next_attempt_at,matcher_version,status) VALUES($1,$2,favlib_next_paris_monday(now()),$3,'PENDING') ON CONFLICT(media_id) DO NOTHING", [mediaId,mangaDex.id,bridgeDecision.matcherVersion]);
            if (mangaDex.coverUrl) await saveCover(h,mediaId,mangaDex.coverUrl,'mangadex','MangaDex',{externalId:mangaDex.id});
            await markFavoriteMatched(h.query,mediaId); await reconcileResolvedFavoriteReviews(h.query,mediaId,'mangadex-valid-resolution');
            await finishEnrichment(h,{mediaId,provider:'mangaupdates',purpose:'metadata',version:VERSION,owner:claim.owner,status:'SUCCESS',externalId:mangaDex.id,resolutionCode:'MANGADEX_VALID_RESOLUTION'});
            return;
          }
        } else {
          trace(h, bridgeDecision.status === 'AMBIGUOUS' ? 'bridge_ambiguous' : bridgeDecision.candidate && !bridgeDecision.candidate.mangaUpdatesId ? 'missing_mu_link' : 'bridge_no_match', { provider: 'mangadex', mediaId });
        }
      } catch (error) {
        trace(h, 'bridge_error', { provider: 'mangadex', mediaId, status: 'ERROR', error: normalizedError(error) });
      }
    }
    await h.query(
      "UPDATE media_enrichment_state SET candidate_snapshot=$1::jsonb,updated_at=now() WHERE media_id=$2 AND provider='mangaupdates' AND purpose='metadata' AND connector_version=$3",
      [JSON.stringify(snapshotCandidates(candidates)), mediaId, VERSION],
    );
    if (matchDecision.status === 'MATCH') {
      selected = matchDecision.candidate;
      fastPath = true;
      await h.query("UPDATE bookmark_media_link SET evidence=evidence||$2::jsonb WHERE media_id=$1 AND status IN ('matched','accepted','review')", [mediaId, JSON.stringify({ resolution: matchDecision.method?.toUpperCase().replaceAll('-', '_') ?? 'TITLE_MATCH', matcherVersion: matchDecision.matcherVersion, matchedAlias: matchDecision.matchedAlias, providerTitle: matchDecision.providerTitle, rawProvenance: matchDecision.rawProvenance })]);
    }
    const ambiguity = matchDecision.status === 'AMBIGUOUS';
    if (ambiguity) {
      const titleRow = await h.query("SELECT t.text,t.provenance->>'sourceUrl' AS url FROM media_title t WHERE t.media_id=$1 AND t.kind='personal' ORDER BY t.id DESC LIMIT 1", [mediaId]);
      const sourceRow = await h.query("SELECT t.text,t.provenance->>'sourceUrl' AS url FROM media_title t WHERE t.media_id=$1 AND t.kind='source' ORDER BY CASE WHEN t.title_type='official' THEN 0 ELSE 1 END,t.id LIMIT 1", [mediaId]);
      const reviewCandidates = rankMangaUpdatesReviewCandidates(identityAliases, candidates, 5);
      await openReviewsForMedia(h.query, { title: sourceRow.rows[0]?.text ?? titleRow.rows[0]?.text ?? searchAliases[0], url: sourceRow.rows[0]?.url ?? titleRow.rows[0]?.url ?? '', provider: 'mangaupdates', candidates: reviewCandidates, mediaId, reason: 'AMBIGUOUS', persistCover: (profileId, imageUrl, provider) => imageUrl ? saveProviderProfileCover(h, profileId, imageUrl, provider, { timeoutMs }) : Promise.resolve() });
      await h.query("UPDATE bookmark_media_link l SET status='review',evidence=evidence||jsonb_build_object('resolution','ambiguous-review'::text) WHERE l.media_id=$1 AND l.status IN ('matched','accepted','review') AND NOT EXISTS(SELECT 1 FROM favorite_review r WHERE r.user_id=l.user_id AND r.installation_id=l.installation_id AND r.bookmark_id=l.bookmark_id AND r.status='RESOLVED' AND r.decision IS NOT NULL)", [mediaId]);
      await finishEnrichment(h, {
        mediaId, provider: 'mangaupdates', purpose: 'metadata', version: VERSION,
        owner: claim.owner, status: 'NO_MATCH', errorCode: 'AMBIGUOUS', resolutionCode: 'AMBIGUOUS',
      });
      return;
    }
    // A provider identity is the canonical work. An existing owner remains a
    // valid candidate: the new favorite must converge onto it, not create a
    // second work merely because its provisional source media differs.
    selected = selected ?? (matchDecision.status === 'MATCH' ? matchDecision.candidate : undefined);
    if (!selected) {
      const titleRow = await h.query("SELECT t.text,t.provenance->>'sourceUrl' AS url FROM media_title t WHERE t.media_id=$1 AND t.kind='personal' ORDER BY t.id DESC LIMIT 1", [mediaId]);
      const sourceRow = await h.query("SELECT t.text,t.provenance->>'sourceUrl' AS url FROM media_title t WHERE t.media_id=$1 AND t.kind='source' ORDER BY CASE WHEN t.title_type='official' THEN 0 ELSE 1 END,t.id LIMIT 1", [mediaId]);
      const unresolvedReason = candidates.length ? 'LOW_CONFIDENCE' : 'NO_RESULT';
      await openReviewsForMedia(h.query, { title: sourceRow.rows[0]?.text ?? titleRow.rows[0]?.text ?? searchAliases[0], url: sourceRow.rows[0]?.url ?? titleRow.rows[0]?.url ?? '', provider: 'mangaupdates', candidates: rankMangaUpdatesReviewCandidates(identityAliases,candidates,5), mediaId, reason: unresolvedReason, persistCover: (profileId, imageUrl, provider) => imageUrl ? saveProviderProfileCover(h, profileId, imageUrl, provider, { timeoutMs }) : Promise.resolve() });
      await finishEnrichment(h, {
        mediaId,
        provider: "mangaupdates",
        purpose: "metadata",
        version: VERSION,
        owner: claim.owner,
        status: claim.attempt_count >= maxAttempts ? "TERMINAL" : "NO_MATCH",
        errorCode: unresolvedReason,
        resolutionCode: unresolvedReason,
      });
      await markFavoriteUnresolved(h.query, mediaId, unresolvedReason);
      return;
    }
    const s = selected;
    await excludeFavoriteMediaByTaxonomy(h.query, mediaId, "mangaupdates", s);
    const exactResolution = bridgeProvenance ? 'MANGADEX_MANGAUPDATES_BRIDGE' : matchDecision.method?.toUpperCase().replaceAll('-', '_') ?? 'TITLE_MATCH';
    if (bridgeProvenance) await h.query("UPDATE bookmark_media_link SET evidence=evidence||$2::jsonb WHERE media_id=$1 AND status IN ('matched','accepted','review')", [mediaId, JSON.stringify({ resolution: 'mangadex-mangaupdates-bridge', rawProvenance: bridgeProvenance })]);
    const owner = await h.query(
      "SELECT media_id FROM media_external_id WHERE provider='mangaupdates' AND external_id=$1",
      [s.id],
    );
    const targetMediaId = owner.rows[0]?.media_id ?? mediaId;
    if (targetMediaId !== mediaId) {
      trace(h, "provider_converge", {
        provider: "mangaupdates",
        externalId: s.id,
        existingMedia: targetMediaId,
        provisionalMedia: mediaId,
      });
      await h.query("SELECT merge_media_identity($1::text,$2::text,'mangaupdates',$3::text,$4::jsonb)", [mediaId, targetMediaId, String(s.id), JSON.stringify({source:'mangaupdates-provider-id',externalId:s.id})]);
    } else {
      await h.query(
        "INSERT INTO media_external_id(media_id,provider,external_id,provenance) VALUES($1,'mangaupdates',$2,$3) ON CONFLICT(provider,external_id) DO NOTHING",
        [mediaId, s.id, bridgeProvenance ? { source: "MangaUpdates", bridge: bridgeProvenance } : { source: "MangaUpdates" }],
      );
    }
    const providerType = mangaUpdatesMediaType(s.type);
    if (providerType)
      await h.query(
        "UPDATE media SET type=$2,updated_at=now() WHERE id=$1 AND type IN ('MANGA','MANHWA','MANHUA')",
        [targetMediaId, providerType],
      );
    const canonicalTitle = cleanDisplayTitle(s.title ?? "") ?? s.title ?? aliases[0] ?? "Unknown title";
    for (const title of [
      ...new Set([s.title, ...(s.titles ?? [])].filter(Boolean)),
    ])
      await h.query(
        "INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,connector,confidence,provenance) VALUES($1,$2,$3,NULL,'supplier','associated','mangaupdates',$4,$5) ON CONFLICT DO NOTHING",
        [targetMediaId, title, normalizeTitle(title), 1, { provider: "mangaupdates", externalId: s.id }],
      );
    if (s.title) {
      await h.query(
        "UPDATE media_title SET text=$2,normalized_text=$3,confidence=1,provenance=provenance || $4::jsonb WHERE media_id=$1 AND kind='official' AND title_type='canonical' AND connector='mangaupdates' AND provenance->>'externalId'=$5",
        [targetMediaId, canonicalTitle, normalizeTitle(canonicalTitle), JSON.stringify({ provider: "mangaupdates", externalId: s.id, canonical: true }), String(s.id)],
      );
    }
    const canonicalExists = await h.query(
      "SELECT 1 FROM media_title WHERE media_id=$1 AND kind='official' AND title_type='canonical' AND connector='mangaupdates' AND provenance->>'externalId'=$2 LIMIT 1",
      [targetMediaId, String(s.id)],
    );
    if (s.title && !canonicalExists.rows[0])
      await h.query(
        "INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,connector,confidence,provenance) VALUES($1,$2,$3,'en','official','canonical','mangaupdates',$4,$5) ON CONFLICT DO NOTHING",
        [
          targetMediaId,
          canonicalTitle,
          normalizeTitle(canonicalTitle),
          1,
          {
            provider: "mangaupdates",
            externalId: s.id,
            canonical: true,
          },
        ],
      );
    const sourceUrl = s.url ?? `https://www.mangaupdates.com/series/${s.id}`;
    const rawPayload = s.raw ?? s;
    const rawPayloadJson = JSON.stringify(rawPayload);
    const rawPayloadHash = createHash('sha256').update(rawPayloadJson).digest('hex');
    const chapter=mangaUpdatesAvailableChapter(s.latestChapter);
    // Clean legacy zero sentinels before the monotonic upserts below. They are
    // absence, so they must not outrank a raw favorite observation.
    await h.query("UPDATE media_metadata SET latest_chapter=NULL,updated_at=now() WHERE media_id=$1 AND provider='mangaupdates' AND latest_chapter ~ '^[[:space:]]*0(?:[.]0+)?[[:space:]]*$'",[targetMediaId]);
    await h.query("DELETE FROM metadata_assertion WHERE media_id=$1 AND provider='mangaupdates' AND field='latestChapter' AND value#>>'{}' ~ '^[[:space:]]*0(?:[.]0+)?[[:space:]]*$'",[targetMediaId]);
    await h.query("UPDATE provider_progress SET latest_chapter=NULL,available_position_kind=NULL,available_position_number=NULL,available_position_raw=NULL,available_position_provenance=NULL,updated_at=now() WHERE media_id=$1 AND provider='mangaupdates' AND available_position_number=0",[targetMediaId]);
    await h.query("INSERT INTO provider_payload(media_id,provider,connector_version,collected_at,payload_hash,payload,provenance,validity_status,is_current) VALUES($1,'mangaupdates',$2,now(),$3,$4,$5,'VALID',true) ON CONFLICT(media_id,provider,connector_version,payload_hash) DO UPDATE SET collected_at=now(),provenance=excluded.provenance,validity_status='VALID',is_current=true", [targetMediaId, VERSION, rawPayloadHash, rawPayloadJson, {provider:'mangaupdates',seriesId:s.id,sourceUrl,verifiedAt:new Date().toISOString(),bridge:bridgeProvenance??null}]);
    await h.query("UPDATE provider_payload SET is_current=false WHERE media_id=$1 AND provider='mangaupdates' AND connector_version=$2 AND payload_hash<>$3", [targetMediaId,VERSION,rawPayloadHash]);
    await h.query(
      "INSERT INTO media_metadata(media_id,provider,external_id,source_url,latest_chapter,status,resolved_at,updated_at) VALUES($1,'mangaupdates',$2,$3,$4,'ACTIVE',now(),now()) ON CONFLICT(media_id) DO UPDATE SET provider='mangaupdates',external_id=excluded.external_id,source_url=excluded.source_url,latest_chapter=COALESCE(excluded.latest_chapter,media_metadata.latest_chapter),status='ACTIVE',updated_at=now()",
      [targetMediaId, s.id, sourceUrl, chapter?.raw ?? null],
    );
    const muValues: Array<[string, unknown]> = [
      ["themes", [...new Set([...(s.genres ?? []), ...(s.categories ?? [])])]],
      ["genres", s.genres ?? []],
      ["categories", s.categories ?? []],
      ["authors", s.authors ?? []],
      ["startDate", s.startDate ?? (s.year === undefined ? undefined : { year: s.year })],
      ["status", s.status],
      ["year", s.year],
      ["latestChapter", chapter?.raw],
      ["latestVolume", s.latestVolume],
      ["description", s.description],
    ];
    for (const [field, value] of muValues) {
      if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) continue;
      await h.query(
        "INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence,attribution) VALUES($1,$2,$3,'mangaupdates',$4,1,'MangaUpdates') ON CONFLICT(media_id,field,provider,source_url) DO UPDATE SET value=excluded.value,confidence=excluded.confidence,attribution=excluded.attribution,asserted_at=now()",
        [targetMediaId, field, JSON.stringify(value), sourceUrl],
      );
    }
    await h.query(`INSERT INTO provider_progress(media_id,provider,serialization_status,latest_chapter,latest_volume,available_position_kind,available_position_number,available_position_raw,available_position_provenance,last_checked_at,status,last_error,provenance,updated_at) VALUES($1,'mangaupdates',$2,$3,$4,$5,$6,$7,$8,now(),'ACTIVE',NULL,$9,now()) ON CONFLICT(media_id,provider) DO UPDATE SET serialization_status=COALESCE(excluded.serialization_status,provider_progress.serialization_status),latest_chapter=CASE WHEN excluded.available_position_number IS NOT NULL AND (provider_progress.available_position_number IS NULL OR excluded.available_position_number>=provider_progress.available_position_number) THEN excluded.latest_chapter ELSE provider_progress.latest_chapter END,latest_volume=CASE WHEN excluded.available_position_number IS NOT NULL AND (provider_progress.available_position_number IS NULL OR excluded.available_position_number>=provider_progress.available_position_number) THEN COALESCE(excluded.latest_volume,provider_progress.latest_volume) ELSE provider_progress.latest_volume END,available_position_kind=COALESCE(excluded.available_position_kind,provider_progress.available_position_kind),available_position_number=CASE WHEN excluded.available_position_number IS NULL OR provider_progress.available_position_number>excluded.available_position_number THEN provider_progress.available_position_number ELSE excluded.available_position_number END,available_position_raw=CASE WHEN excluded.available_position_number IS NOT NULL AND (provider_progress.available_position_number IS NULL OR excluded.available_position_number>=provider_progress.available_position_number) THEN excluded.available_position_raw ELSE provider_progress.available_position_raw END,available_position_provenance=CASE WHEN excluded.available_position_number IS NOT NULL AND (provider_progress.available_position_number IS NULL OR excluded.available_position_number>=provider_progress.available_position_number) THEN excluded.available_position_provenance ELSE provider_progress.available_position_provenance END,last_checked_at=now(),status='ACTIVE',last_error=NULL,provenance=provider_progress.provenance||excluded.provenance,updated_at=now()`,[targetMediaId,normalizeSerializationStatus(s.status)??null,chapter?.raw??null,s.latestVolume??null,chapter?'chapter':null,chapter?.number??null,chapter?.raw??null,chapter?{provider:'mangaupdates',seriesId:s.id,evidence:'series-record',raw:rawPayload,verifiedAt:new Date().toISOString()}:null,{provider:'mangaupdates',seriesId:s.id,payloadHash:rawPayloadHash,raw:rawPayload,verifiedAt:new Date().toISOString()}]);
    await markFavoriteMatched(h.query, targetMediaId);
    await reconcileResolvedFavoriteReviews(h.query, targetMediaId, bridgeProvenance ? 'mangadex-mangaupdates-bridge' : 'automatic-provider-resolution');
    if (bridgeProvenance)
      await h.query("UPDATE mangadex_promotion_state SET status='PROMOTED',mangaupdates_id=$2,next_attempt_at=now(),last_attempt_at=now(),last_error=NULL,promoted_at=COALESCE(promoted_at,now()),updated_at=now() WHERE media_id IN ($1,$3)", [targetMediaId, String(s.id), mediaId]);
    await finishEnrichment(h, {
      mediaId,
      provider: "mangaupdates",
      purpose: "metadata",
      version: VERSION,
      owner: claim.owner,
      status: "SUCCESS",
      externalId: s.id,
      resolutionCode: exactResolution,
    });
    await enrichCover(targetMediaId, h);
    return;
  } catch (e) {
    const code = normalizedError(e);
    if (isProtectedResolvedLinkError(code)) {
      h.logger.warn(`[resolved-link-protected] provider=mangaupdates mediaId=${mediaId}`);
      return;
    }
    await finishEnrichment(h, {
      mediaId,
      provider: "mangaupdates",
      purpose: "metadata",
      version: VERSION,
      owner: claim.owner,
      status: claim.attempt_count >= maxAttempts ? "TERMINAL" : "FAILED",
      errorCode: code,
      resolutionCode: code,
    });
    if (claim.attempt_count >= maxAttempts || code === "NO_RESULT" || code === "NO_MATCH")
      await markFavoriteUnresolved(h.query, mediaId, code);
    h.logger.warn(`MangaUpdates enrichment failed for ${mediaId}: ${code}`);
    return;
  }
};
export default task;
