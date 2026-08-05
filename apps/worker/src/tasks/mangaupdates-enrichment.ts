import type { Task } from "graphile-worker";
import {
  fetchAniList,
  fetchMangaUpdatesSeries,
  normalizeTitle,
  searchAniList,
  searchMangaUpdatesSeries,
  titleVariants,
  resolveMangaUpdatesSeries,
} from "@favlib/metadata";
import { aniListHooks } from "../anilist-gate.js";
import { saveCover } from "../cover-store.js";
import {
  acquireProviderSlot,
  claimEnrichment,
  enrichmentFingerprint,
  finishEnrichment,
  normalizedError,
  waitProviderGate,
} from "../enrichment-state.js";
import { operationalValue } from "../settings.js";
import { notifyCoverUnavailable } from "../cover-notify.js";

type Helpers = Parameters<Task>[1];
const VERSION = "mangaupdates-v4",
  COVER_VERSION = "anilist-cover-v5";
function trace(h: any, event: string, data: Record<string, unknown>) {
  h.logger.warn(`[provider-trace] ${JSON.stringify({ event, ...data })}`);
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
    provider: "anilist",
    purpose: "cover",
    version: COVER_VERSION,
    fingerprint,
    maxAttempts,
  });
  if (!claim) return { status: "SKIPPED", reason: "STATE_NOT_DUE" };
  try {
    const series = await providerCall(h, () =>
      fetchMangaUpdatesSeries(String(resolvedMu.rows[0].external_id), providerOptions),
    );
    if (series.image) {
      await saveCover(h, mediaId, series.image, "mangaupdates", "MangaUpdates", {
        timeoutMs,
        externalId: String(resolvedMu.rows[0].external_id),
      });
      await finishEnrichment(h, {
        mediaId,
        provider: "anilist",
        purpose: "cover",
        version: COVER_VERSION,
        owner: claim.owner,
        status: "SUCCESS",
        externalId: String(resolvedMu.rows[0].external_id),
        resolutionCode: "MANGAUPDATES_COVER",
      });
      return { status: "SUCCESS", mediaId, provider: "mangaupdates" };
    }
    const old = await h.query(
      "SELECT external_id FROM media_external_id WHERE media_id=$1 AND provider='anilist' AND provenance->>'historical'='true' LIMIT 1",
      [mediaId],
    );
    let anilistId = Number(old.rows[0]?.external_id);
    let al;
    if (Number.isInteger(anilistId) && anilistId > 0) {
      al = await fetchAniList(anilistId, {
        timeoutMs,
        hooks: aniListHooks(h),
      });
    } else {
      for (const alias of aliases) {
        const results = await searchAniList(alias, {
          type: "MANGA",
          timeoutMs,
          hooks: aniListHooks(h),
        });
        if (results.length) {
          al = results[0];
          anilistId = al.id;
          break;
        }
      }
    }
    if (!al) throw new Error("NO_RESULT");
    if (!al.coverImage) throw new Error("NO_COVER");
    await saveCover(h, mediaId, al.coverImage, "anilist", "AniList", {
      timeoutMs,
      externalId: String(anilistId),
    });
    await finishEnrichment(h, {
      mediaId,
      provider: "anilist",
      purpose: "cover",
      version: COVER_VERSION,
      owner: claim.owner,
      status: "SUCCESS",
      externalId: String(anilistId),
      resolutionCode: "ANILIST_COVER",
    });
    return { status: "SUCCESS", mediaId, provider: "anilist" };
  } catch (error) {
    const code = normalizedError(error);
    await notifyCoverUnavailable(h.query.bind(h), mediaId, code);
    await finishEnrichment(h, {
      mediaId,
      provider: "anilist",
      purpose: "cover",
      version: COVER_VERSION,
      owner: claim.owner,
      status: claim.attempt_count >= maxAttempts ? "TERMINAL" : "FAILED",
      errorCode: code,
      resolutionCode: "COVER_UNAVAILABLE",
    });
    return { status: "FAILED", reason: code };
  }
}

const task: Task = async (raw, helpers: Helpers) => {
  const h = helpers as any,
    mediaId = String((raw as any)?.mediaId ?? "");
  if ((raw as any)?.cover === true) {
    await enrichCover(mediaId, h);
    return;
  }
  const timeoutMs = await operationalValue(h, "timeouts.providerMs"),
    maxAttempts = await operationalValue(h, "metadata.maxAttempts");
  const row = await h.query(
    "SELECT m.type,m.season_year AS year,m.country_of_origin AS country,m.format,COALESCE((SELECT json_agg(t.text ORDER BY CASE t.kind WHEN 'source' THEN 0 WHEN 'official' THEN 1 WHEN 'supplier' THEN 2 WHEN 'synonym' THEN 3 ELSE 4 END,t.id) FROM media_title t WHERE t.media_id=m.id),'[]') AS titles FROM media m WHERE m.id=$1",
    [mediaId],
  );
  if (!row.rows[0]) return;
  const c = row.rows[0];
  if (!["MANGA", "MANHWA", "MANHUA"].includes(c.type)) return;
  const aliases = (Array.isArray(c.titles) ? c.titles : [])
    .filter(Boolean)
    .filter((value: unknown) =>
      typeof value === "string" &&
      !/^manga\s+[a-z]{1,3}\d{4,}$/iu.test(value.trim()),
    );
  const queries = titleVariants(aliases).filter((value) => value.length > 2);
  const fp = enrichmentFingerprint({ mediaId, type: c.type, aliases });
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
    const providerOptions = { timeoutMs };
    for (const q of queries) {
      const results = await providerCall(h, () =>
        searchMangaUpdatesSeries(q, providerOptions),
      );
      candidates.push(...results);
    }
    candidates = [...new Map(candidates.map((x) => [x.id, x])).values()];
    // Search responses are intentionally incomplete. Resolve every distinct hit
    // before scoring it, while retaining hit_title as an additional signal.
    const detailed: any[] = [];
    for (const candidate of candidates) {
      try {
        const record = await providerCall(h, () =>
          fetchMangaUpdatesSeries(candidate.id, providerOptions),
        );
        detailed.push({ ...record, hitTitle: candidate.hitTitle ?? candidate.title });
      } catch {
        // A single stale/dead result must not prevent other aliases/results.
        detailed.push(candidate);
      }
    }
    candidates = [...new Map(detailed.map((x) => [x.id, x])).values()];
    const available: any[] = [];
    for (const candidate of candidates) {
      const owner = await h.query(
        "SELECT media_id FROM media_external_id WHERE provider='mangaupdates' AND external_id=$1 LIMIT 1",
        [candidate.id],
      );
      if (owner.rows[0]?.media_id && owner.rows[0].media_id !== mediaId) {
        trace(h, "provider_collision", {
          provider: "mangaupdates",
          externalId: candidate.id,
          existingMedia: owner.rows[0].media_id,
          candidateMedia: mediaId,
        });
        continue;
      }
      available.push(candidate);
    }
    selected = resolveMangaUpdatesSeries(aliases, available);
    await h.query(
      "UPDATE media_enrichment_state SET candidate_snapshot=$1::jsonb,updated_at=now() WHERE media_id=$2 AND provider='mangaupdates' AND purpose='metadata' AND connector_version=$3",
      [JSON.stringify(candidates.slice(0, 20)), mediaId, VERSION],
    );
    if (!selected) {
      await finishEnrichment(h, {
        mediaId,
        provider: "mangaupdates",
        purpose: "metadata",
        version: VERSION,
        owner: claim.owner,
        status: claim.attempt_count >= maxAttempts ? "TERMINAL" : "NO_MATCH",
        errorCode: "NO_RESULT",
        resolutionCode: "NO_RESULT",
      });
      return;
    }
    const s = selected;
    const canonicalTitle = s.title ?? aliases[0] ?? "Unknown title";
    await h.query(
      "INSERT INTO media_external_id(media_id,provider,external_id,provenance) VALUES($1,'mangaupdates',$2,$3) ON CONFLICT(provider,external_id) DO NOTHING",
      [mediaId, s.id, { source: "MangaUpdates" }],
    );
    const owner = await h.query(
      "SELECT media_id FROM media_external_id WHERE provider='mangaupdates' AND external_id=$1",
      [s.id],
    );
    if (owner.rows[0]?.media_id !== mediaId)
      throw new Error("MANGAUPDATES_EXTERNAL_ID_CONFLICT");
    for (const title of [
      ...new Set([s.title, ...(s.titles ?? [])].filter(Boolean)),
    ])
      await h.query(
        "INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,connector,confidence,provenance) VALUES($1,$2,$3,NULL,'supplier','associated','mangaupdates',$4,$5) ON CONFLICT DO NOTHING",
        [mediaId, title, normalizeTitle(title), 1, { provider: "mangaupdates", externalId: s.id }],
      );
    if (s.title && !aliases.some((alias: string) => alias === s.title))
      await h.query(
        "INSERT INTO media_title(media_id,text,normalized_text,language,kind,title_type,connector,confidence,provenance) VALUES($1,$2,$3,'en','official','canonical','mangaupdates',$4,$5) ON CONFLICT DO NOTHING",
        [
          mediaId,
          s.title,
          normalizeTitle(s.title),
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
      [mediaId, s.id, s.url ?? null],
    );
    await finishEnrichment(h, {
      mediaId,
      provider: "mangaupdates",
      purpose: "metadata",
      version: VERSION,
      owner: claim.owner,
      status: "SUCCESS",
      externalId: s.id,
      resolutionCode: "SCORED_MATCH",
    });
    await enrichCover(mediaId, h);
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
    h.logger.warn(`MangaUpdates enrichment failed for ${mediaId}: ${code}`);
    return;
  }
};
export default task;
