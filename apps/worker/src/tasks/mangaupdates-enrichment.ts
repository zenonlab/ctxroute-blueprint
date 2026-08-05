import type { Task } from "graphile-worker";
import {
  cleanDisplayTitle,
  exactMangaUpdatesSeriesMatches,
  exactTitleMatchKind,
  fetchMangaUpdatesSeries,
  mangaUpdatesMediaType,
  normalizeTitle,
  searchMangaUpdatesSeries,
  titleVariants,
  resolveMangaUpdatesSeries,
} from "@favlib/metadata";
import { saveCover } from "../cover-store.js";
import {
  acquireProviderSlot,
  claimEnrichment,
  enrichmentFingerprint,
  finishEnrichment,
  normalizedError,
  retryableProviderError,
  waitProviderGate,
} from "../enrichment-state.js";
import { operationalValue } from "../settings.js";
import { notifyCoverUnavailable } from "../cover-notify.js";
import { markFavoriteMatched, markFavoriteUnresolved, reconcileResolvedFavoriteReviews } from "../favorite-resolution.js";
import { openReviewsForMedia } from "../favorite-review.js";
import { isManualOnlyReviewTitle } from "../favorite-review.js";

type Helpers = Parameters<Task>[1];
export const MANGAUPDATES_ENRICHMENT_VERSION = "mangaupdates-v6";
const VERSION = MANGAUPDATES_ENRICHMENT_VERSION,
  COVER_VERSION = "mangaupdates-cover-v6";
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
  const release = await acquireProviderSlot(h, "mangaupdates");
  trace(h, "provider_request", { provider: "mangaupdates", ...context });
  try {
    await waitProviderGate(h, "mangaupdates", 350);
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
  } finally {
    await release();
  }
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
    if (terminal) await notifyCoverUnavailable(h.query.bind(h), mediaId, code);
    return { status: "FAILED", reason: code };
  }
}

const task: Task = async (raw, helpers: Helpers) => {
  const h = helpers as any,
    mediaId = String((raw as any)?.mediaId ?? ""),
    forceRefresh = (raw as any)?.forceRefresh === true;
  if ((raw as any)?.cover === true) {
    await enrichCover(mediaId, h);
    return;
  }
  const timeoutMs = await operationalValue(h, "timeouts.providerMs"),
    maxAttempts = await operationalValue(h, "metadata.maxAttempts");
  const row = await h.query(
    "SELECT m.type,m.season_year AS year,m.country_of_origin AS country,m.format,COALESCE((SELECT json_agg(t.text ORDER BY CASE t.kind WHEN 'source' THEN 0 WHEN 'official' THEN 1 WHEN 'supplier' THEN 2 WHEN 'synonym' THEN 3 ELSE 4 END,t.id) FROM media_title t WHERE t.media_id=m.id),'[]') AS titles,(SELECT external_id FROM media_metadata WHERE media_id=m.id AND provider='mangaupdates' AND status='ACTIVE' LIMIT 1) AS mangaupdates_id FROM media m WHERE m.id=$1",
    [mediaId],
  );
  if (!row.rows[0]) return;
  const c = row.rows[0];
  if (!["MANGA", "MANHWA", "MANHUA"].includes(c.type)) return;
  const alreadyResolved = await h.query(
    "SELECT 1 FROM media_metadata WHERE media_id=$1 AND provider='mangaupdates' AND status='ACTIVE' AND external_id IS NOT NULL LIMIT 1",
    [mediaId],
  );
  if (alreadyResolved.rows[0] && !forceRefresh) {
    await markFavoriteMatched(h.query, mediaId);
    await reconcileResolvedFavoriteReviews(h.query, mediaId);
    return;
  }
  const aliases = (Array.isArray(c.titles) ? c.titles : [])
    .filter(Boolean)
    .filter((value: unknown) =>
      typeof value === "string" &&
      !/^manga\s+[a-z]{1,3}\d{4,}$/iu.test(value.trim()),
    );
  const searchAliases = [...new Set((aliases as string[]).map((value: string) => cleanDisplayTitle(value) ?? value))];
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
    const providerOptions = { timeoutMs };
    const knownMuId = forceRefresh && c.mangaupdates_id
      ? String(c.mangaupdates_id)
      : "";
    if (knownMuId) {
      const record = await providerCall(h, () =>
        fetchMangaUpdatesSeries(knownMuId, providerOptions),
        { operation: "fetch-known", id: knownMuId },
      );
      candidates = [record];
      selected = resolveMangaUpdatesSeries(searchAliases, candidates);
      if (selected) fastPath = true;
    }
    for (const q of knownMuId ? [] : queries) {
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
    const exactMatches = exactMangaUpdatesSeriesMatches(searchAliases, candidates);
    const manualOnlyReview = searchAliases.some((alias: string) => isManualOnlyReviewTitle(alias));
    await h.query(
      "UPDATE media_enrichment_state SET candidate_snapshot=$1::jsonb,updated_at=now() WHERE media_id=$2 AND provider='mangaupdates' AND purpose='metadata' AND connector_version=$3",
      [JSON.stringify(snapshotCandidates(candidates)), mediaId, VERSION],
    );
    if (exactMatches.length === 1) {
      selected = exactMatches[0];
      fastPath = true;
    }
    const ambiguity = !manualOnlyReview && exactMatches.length > 1;
    if (ambiguity) {
      const titleRow = await h.query("SELECT t.text,t.provenance->>'sourceUrl' AS url FROM media_title t WHERE t.media_id=$1 AND t.kind='personal' ORDER BY t.id DESC LIMIT 1", [mediaId]);
      const sourceRow = await h.query("SELECT t.text,t.provenance->>'sourceUrl' AS url FROM media_title t WHERE t.media_id=$1 AND t.kind='source' ORDER BY t.id LIMIT 1", [mediaId]);
      const reviewCandidates = exactMatches.length > 1 ? exactMatches : candidates;
      await openReviewsForMedia(h.query, { title: titleRow.rows[0]?.text ?? sourceRow.rows[0]?.text ?? searchAliases[0], url: titleRow.rows[0]?.url ?? sourceRow.rows[0]?.url ?? '', provider: 'mangaupdates', candidates: reviewCandidates, mediaId, reason: exactMatches.length > 1 ? 'AMBIGUOUS' : 'LOW_CONFIDENCE' });
      await h.query("UPDATE bookmark_media_link SET status='review',evidence=evidence||jsonb_build_object('resolution','ambiguous-review'::text) WHERE media_id=$1 AND status IN ('matched','accepted','review')", [mediaId]);
      await finishEnrichment(h, {
        mediaId, provider: 'mangaupdates', purpose: 'metadata', version: VERSION,
        owner: claim.owner, status: 'NO_MATCH', errorCode: 'AMBIGUOUS', resolutionCode: 'AMBIGUOUS',
      });
      return;
    }
    // A provider identity is the canonical work. An existing owner remains a
    // valid candidate: the new favorite must converge onto it, not create a
    // second work merely because its provisional source media differs.
    selected = manualOnlyReview ? undefined : exactMatches.length === 1
      ? exactMatches[0]
      : resolveMangaUpdatesSeries(searchAliases, candidates) ?? undefined;
    if (!selected) {
      const titleRow = await h.query("SELECT t.text,t.provenance->>'sourceUrl' AS url FROM media_title t WHERE t.media_id=$1 AND t.kind='personal' ORDER BY t.id DESC LIMIT 1", [mediaId]);
      const sourceRow = await h.query("SELECT t.text,t.provenance->>'sourceUrl' AS url FROM media_title t WHERE t.media_id=$1 AND t.kind='source' ORDER BY t.id LIMIT 1", [mediaId]);
      const unresolvedReason = manualOnlyReview ? 'MANUAL_REVIEW' : candidates.length ? 'LOW_CONFIDENCE' : 'NO_RESULT';
      await openReviewsForMedia(h.query, { title: titleRow.rows[0]?.text ?? sourceRow.rows[0]?.text ?? searchAliases[0], url: titleRow.rows[0]?.url ?? sourceRow.rows[0]?.url ?? '', provider: 'mangaupdates', candidates, mediaId, reason: unresolvedReason });
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
    const exactResolution = exactMatches.length === 1 && searchAliases.some((alias) =>
      [s.title, s.hitTitle, ...(s.titles ?? []), ...(s.associated ?? [])]
        .filter((title): title is string => Boolean(title))
        .some((title) => exactTitleMatchKind(alias, title) === 'NORMALIZED_EXACT'))
      ? 'NORMALIZED_EXACT'
      : exactMatches.length === 1 ? 'COMPACT_EXACT' : 'SCORED_MATCH';
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
        [mediaId, s.id, { source: "MangaUpdates" }],
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
    await h.query(
      "INSERT INTO media_metadata(media_id,provider,external_id,source_url,status,resolved_at,updated_at) VALUES($1,'mangaupdates',$2,$3,'ACTIVE',now(),now()) ON CONFLICT(media_id) DO UPDATE SET provider='mangaupdates',external_id=excluded.external_id,source_url=excluded.source_url,status='ACTIVE',updated_at=now()",
      [targetMediaId, s.id, s.url ?? null],
    );
    const muValues: Array<[string, unknown]> = [
      ["themes", [...new Set([...(s.genres ?? []), ...(s.categories ?? [])])]],
      ["genres", s.genres ?? []],
      ["categories", s.categories ?? []],
      ["authors", s.authors ?? []],
      ["startDate", s.startDate ?? (s.year === undefined ? undefined : { year: s.year })],
      ["status", s.status],
      ["year", s.year],
      ["latestChapter", s.latestChapter],
      ["latestVolume", s.latestVolume],
    ];
    for (const [field, value] of muValues) {
      if (value === undefined || value === null || (Array.isArray(value) && value.length === 0)) continue;
      await h.query(
        "INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence,attribution) VALUES($1,$2,$3,'mangaupdates',$4,1,'MangaUpdates') ON CONFLICT(media_id,field,provider,source_url) DO UPDATE SET value=excluded.value,confidence=excluded.confidence,attribution=excluded.attribution,asserted_at=now()",
        [targetMediaId, field, JSON.stringify(value), s.url ?? `https://www.mangaupdates.com/series/${s.id}`],
      );
    }
    await markFavoriteMatched(h.query, targetMediaId);
    await reconcileResolvedFavoriteReviews(h.query, targetMediaId);
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
