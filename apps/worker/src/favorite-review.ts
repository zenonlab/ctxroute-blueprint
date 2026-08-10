import { collectiveTitleKey, contentTaxonomyExclusion, exactTitleMatchKind, prepareTitleCandidates } from '@favlib/metadata';
import { createHash } from 'node:crypto';

type Query = (sql: string, values?: unknown[]) => Promise<any>;

export type ReviewCandidate = Record<string, any> & { id: string | number; title?: string; hitTitle?: string; url?: string };

function candidateImage(candidate: ReviewCandidate) {
  if (typeof candidate.image === 'string' && candidate.image.trim()) return candidate.image;
  if (typeof candidate.coverImage === 'string' && candidate.coverImage.trim()) return candidate.coverImage;
  if (candidate.coverImage && typeof candidate.coverImage === 'object')
    return candidate.coverImage.extraLarge ?? candidate.coverImage.large ?? candidate.coverImage.medium;
  return undefined;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

export async function refreshReviewQueueNotification(query: Query, userId: string) {
  const pending = await query(`SELECT count(DISTINCT COALESCE(r.cluster_id::text,r.id::text))::int AS count
    FROM favorite_review r JOIN bookmark_media_link l ON l.user_id=r.user_id
      AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id
    WHERE r.user_id=$1 AND r.status='PENDING' AND l.status IN ('matched','accepted','review')`, [userId]);
  const count = Number(pending.rows[0]?.count ?? 0);
  if (!count) {
    await query("DELETE FROM personal_notification WHERE user_id=$1 AND kind='FAVORITE_REVIEW_REQUIRED' AND release_key='favorite-review-queue'", [userId]);
    return;
  }
  await query(`INSERT INTO personal_notification(user_id,release_key,kind,payload)
    VALUES($1,'favorite-review-queue','FAVORITE_REVIEW_REQUIRED',jsonb_build_object('title','Correspondances à résoudre','message',$2::text,'count',$3::int,'url','/review'))
    ON CONFLICT(user_id,release_key,kind) DO UPDATE SET payload=excluded.payload,read_at=NULL`, [userId, `Il reste ${count} favori${count > 1 ? 's' : ''} à vérifier.`, count]);
}

/** Persist a complete, provider-specific ambiguity decision exactly once. */
export async function openFavoriteReview(query: Query, input: {
  userId: string; installationId?: string; bookmarkId?: string; title: string; url: string;
  provider: 'anilist'|'mangaupdates'; candidates: ReviewCandidate[]; mediaId?: string; reason?: string;
  persistCover?: (profileId: string, imageUrl: string, provider: 'anilist'|'mangaupdates') => Promise<unknown>;
}) {
  const candidates = [...new Map(input.candidates.map(candidate => [String(candidate.id),candidate] as const)).values()]
    .filter(candidate => !contentTaxonomyExclusion({genres:candidate.genres,categories:candidate.categories ?? (Array.isArray(candidate.tags)?candidate.tags.map((tag:any)=>typeof tag==='string'?tag:tag?.name):[])}))
    .slice(0, 5);
  const link = await query(`SELECT l.installation_id AS "installationId",l.bookmark_id AS "bookmarkId",i.payload->>'title' AS "rawFavoriteTitle",i.payload->>'url' AS "favoriteUrl",i.parse_artifact AS "parseArtifact"
    FROM bookmark_media_link l LEFT JOIN bookmark_import_item i ON i.user_id=l.user_id AND i.installation_id=l.installation_id AND i.bookmark_id=l.bookmark_id
    WHERE l.user_id=$1 AND ($2::text IS NULL OR l.media_id=$2) AND ($3::text IS NULL OR l.installation_id=$3) AND ($4::text IS NULL OR l.bookmark_id=$4) ORDER BY l.created_at DESC LIMIT 1`, [input.userId, input.mediaId ?? null, input.installationId ?? null, input.bookmarkId ?? null]);
  const installationId = input.installationId ?? link.rows[0]?.installationId ?? 'worker';
  const bookmarkId = input.bookmarkId ?? link.rows[0]?.bookmarkId ?? input.mediaId ?? input.url;
  const decided = await query(`SELECT id,status FROM favorite_review
    WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3 AND provider=$4
      AND status IN ('RESOLVED','NO_MATCH') AND decision IS NOT NULL
    ORDER BY resolved_at DESC NULLS LAST,id DESC LIMIT 1`, [input.userId,installationId,bookmarkId,input.provider]);
  if (decided.rows?.[0]) return decided.rows[0].id;
  // The review must show what the user actually imported from Chrome. The
  // parsed/source title is only a resolver hint and may be an opaque URL slug
  // such as `Lw931574`.
  const rawFavoriteTitle = link.rows[0]?.rawFavoriteTitle ?? link.rows[0]?.favoriteTitle ?? input.title;
  const favoriteUrl = link.rows[0]?.favoriteUrl || input.url || '';
  const artifact = link.rows[0]?.parseArtifact as {identity?:{title?:string}|null;displayTitle?:string|null}|undefined;
  // New imports consume the API-owned v3 artifact without reparsing. The
  // fallback is limited to rows created before the additive migration.
  const legacyPrepared = artifact ? undefined : prepareTitleCandidates({ bookmarkTitle: rawFavoriteTitle, url: favoriteUrl });
  const favoriteTitle = artifact?.identity?.title ?? artifact?.displayTitle ?? legacyPrepared?.sourceTitle ?? legacyPrepared?.personal ?? rawFavoriteTitle.trim();
  const mediaType = input.provider === 'anilist' ? 'ANIME' : 'MANGA';
  const clusterKey = collectiveTitleKey({ provider: input.provider, mediaType, parsedTitle: favoriteTitle });
  const cluster = await query(`INSERT INTO review_title_cluster(cluster_key,provider,media_type,parsed_title,raw_title_sample)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(cluster_key) DO UPDATE SET updated_at=now() RETURNING id`,
    [clusterKey,input.provider,mediaType,favoriteTitle,rawFavoriteTitle]);
  const clusterId = cluster.rows[0]?.id ?? clusterKey;
  const reusable = await query(`SELECT min(COALESCE(NULLIF(r.decision->>'mediaId',''),l.media_id)) AS "mediaId",min(e.external_id) AS "providerId",min(r.id::text) AS "sourceReviewId"
    FROM favorite_review r
    JOIN bookmark_media_link l ON l.user_id=r.user_id AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id
    JOIN media_external_id e ON e.media_id=COALESCE(NULLIF(r.decision->>'mediaId',''),l.media_id) AND e.provider=$3
      AND e.external_id=COALESCE(NULLIF(r.decision->>'providerId',''),NULLIF(r.decision->>'externalId',''),e.external_id)
    WHERE r.user_id=$1 AND r.cluster_id=$2 AND r.provider=$3 AND r.status='RESOLVED' AND r.decision IS NOT NULL
    HAVING count(DISTINCT COALESCE(NULLIF(r.decision->>'mediaId',''),l.media_id))=1 AND count(DISTINCT e.external_id)=1`,[input.userId,clusterId,input.provider]);
  const noMatch = reusable.rows?.[0]?.mediaId ? undefined : await query(`SELECT min(r.id::text) AS "sourceReviewId" FROM favorite_review r
    WHERE r.user_id=$1 AND r.cluster_id=$2 AND r.provider=$3 AND r.status='NO_MATCH' AND r.decision IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM favorite_review conflict WHERE conflict.user_id=r.user_id AND conflict.cluster_id=r.cluster_id AND conflict.provider=r.provider AND conflict.status='RESOLVED' AND conflict.decision IS NOT NULL)
    HAVING count(*)>0`,[input.userId,clusterId,input.provider]);
  if (reusable.rows?.[0]?.mediaId) {
    const prior=reusable.rows[0];
    await query(`UPDATE bookmark_media_link SET media_id=$1,status='matched',evidence=evidence||$2::jsonb
      WHERE user_id=$3 AND installation_id=$4 AND bookmark_id=$5`,[prior.mediaId,JSON.stringify({resolution:'same-user-cluster-reuse',provider:input.provider,providerId:prior.providerId,sourceReviewId:prior.sourceReviewId}),input.userId,installationId,bookmarkId]);
    const reused=await query(`INSERT INTO favorite_review(user_id,installation_id,bookmark_id,favorite_title,favorite_url,provider,status,reason,cluster_id,decision,resolved_at)
      VALUES($1,$2,$3,$4,$5,$6,'RESOLVED','REUSED_RESOLVED_DECISION',$7,$8::jsonb,now())
      ON CONFLICT(user_id,installation_id,bookmark_id,provider) DO NOTHING RETURNING id`,[input.userId,installationId,bookmarkId,favoriteTitle,favoriteUrl,input.provider,clusterId,JSON.stringify({kind:'same-user-cluster-reuse',sourceReviewId:prior.sourceReviewId,provider:input.provider,providerId:prior.providerId,mediaId:prior.mediaId})]);
    return reused.rows?.[0]?.id ?? prior.sourceReviewId;
  }
  if (noMatch?.rows?.[0]?.sourceReviewId) {
    const reused=await query(`INSERT INTO favorite_review(user_id,installation_id,bookmark_id,favorite_title,favorite_url,provider,status,reason,cluster_id,decision,resolved_at)
      VALUES($1,$2,$3,$4,$5,$6,'NO_MATCH','REUSED_NO_MATCH_DECISION',$7,$8::jsonb,now())
      ON CONFLICT(user_id,installation_id,bookmark_id,provider) DO NOTHING RETURNING id`,[input.userId,installationId,bookmarkId,favoriteTitle,favoriteUrl,input.provider,clusterId,JSON.stringify({kind:'same-user-cluster-no-match',sourceReviewId:noMatch.rows[0].sourceReviewId})]);
    return reused.rows?.[0]?.id ?? noMatch.rows[0].sourceReviewId;
  }
  const review = await query(`INSERT INTO favorite_review(user_id,installation_id,bookmark_id,favorite_title,favorite_url,provider,status,reason)
    VALUES($1,$2,$3,$4,$5,$6,'PENDING',$7) ON CONFLICT(user_id,installation_id,bookmark_id,provider)
    DO UPDATE SET favorite_title=excluded.favorite_title,favorite_url=excluded.favorite_url,reason=COALESCE(excluded.reason,favorite_review.reason)
    RETURNING id`, [input.userId, installationId, bookmarkId, favoriteTitle, favoriteUrl, input.provider, input.reason ?? null]);
  const reviewId = review.rows[0].id;
  await query('UPDATE favorite_review SET cluster_id=$2 WHERE id=$1', [reviewId, clusterId]);
  for (const candidate of candidates) {
    const title = String(candidate.title ?? candidate.name ?? `${input.provider} ${candidate.id}`);
    const known = await query("SELECT media_id AS \"mediaId\" FROM media_external_id WHERE provider=$1 AND external_id=$2 LIMIT 1", [input.provider, String(candidate.id)]);
    const texts = (value: unknown) => Array.isArray(value) ? value.map(item => typeof item === 'string' ? item : JSON.stringify(item)) : [];
    const payload = stableJson(candidate);
    const payloadHash = createHash('sha256').update(payload).digest('hex');
    const profile = await query(`INSERT INTO provider_profile(provider,provider_id,payload_hash,canonical_title,associated_titles,type,year,start_date,status,authors,categories,genres,image,url,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,$15::jsonb)
      ON CONFLICT(provider,provider_id,payload_hash) DO UPDATE SET last_seen_at=now()
      RETURNING id`, [
        input.provider, String(candidate.id), payloadHash, title,
        texts(candidate.titles ?? candidate.synonyms ?? candidate.associated), candidate.type ?? null,
        candidate.year ?? candidate.startYear ?? candidate.seasonYear ?? null, candidate.startDate == null ? null : JSON.stringify(candidate.startDate),
        candidate.status ?? null, candidate.authors == null ? null : JSON.stringify(candidate.authors), texts(candidate.categories), texts(candidate.genres),
        candidateImage(candidate) ?? null,
        candidate.url ?? candidate.siteUrl ?? `https://${input.provider === 'anilist' ? 'anilist.co' : 'mangaupdates.com'}`,
        payload]);
    if (input.persistCover) await input.persistCover(String(profile.rows[0].id), candidateImage(candidate) ?? '', input.provider);
    await query('INSERT INTO review_cluster_candidate(cluster_id,profile_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [clusterId, profile.rows[0].id]);
    await query(`INSERT INTO favorite_review_candidate(review_id,profile_id,provider_id,hit_title,media_id)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(review_id,provider_id) DO UPDATE SET profile_id=excluded.profile_id,hit_title=excluded.hit_title,media_id=COALESCE(excluded.media_id,favorite_review_candidate.media_id)`, [
        reviewId, profile.rows[0].id, String(candidate.id), candidate.hitTitle ?? null, known.rows[0]?.mediaId ?? null]);
  }
  await query(`INSERT INTO favorite_review_candidate(review_id,profile_id,provider_id)
    SELECT DISTINCT ON(r.id,p.provider_id) r.id,cc.profile_id,p.provider_id FROM favorite_review r
    JOIN review_cluster_candidate cc ON cc.cluster_id=r.cluster_id JOIN provider_profile p ON p.id=cc.profile_id
    WHERE r.cluster_id=$1 AND r.status='PENDING'
    ORDER BY r.id,p.provider_id,p.last_seen_at DESC,p.id DESC
    ON CONFLICT(review_id,provider_id) DO UPDATE SET profile_id=excluded.profile_id`, [clusterId]);
  const local = await query(`SELECT p.provider_id FROM review_cluster_candidate cc JOIN provider_profile p ON p.id=cc.profile_id LEFT JOIN review_title_cluster cl ON cl.id=cc.cluster_id WHERE cc.cluster_id=$1 ORDER BY (cc.locked_at IS NOT NULL) DESC,(cl.consensus_profile_id=cc.profile_id) DESC,(SELECT count(DISTINCT e.user_id) FROM review_cluster_endorsement e WHERE e.cluster_id=cc.cluster_id AND e.profile_id=cc.profile_id) DESC,(SELECT count(*) FROM favorite_review_candidate rc JOIN favorite_review r ON r.id=rc.review_id WHERE r.cluster_id=cc.cluster_id AND rc.profile_id=cc.profile_id AND r.status='PENDING') DESC,(p.cover_status='ACTIVE') DESC,(p.type IS NOT NULL)::int+(p.year IS NOT NULL)::int DESC,favlib_provider_audience_signal(p.payload) DESC,cc.created_at,p.provider_id LIMIT 5`, [clusterId]);
  const currentProviderIds = local.rows.length ? local.rows.map((row:any)=>row.provider_id) : [...new Set(candidates.map(candidate=>String(candidate.id)))];
  await query('DELETE FROM favorite_review_candidate WHERE review_id=$1 AND NOT (provider_id=ANY($2::text[]))', [reviewId, currentProviderIds]);
  await refreshReviewQueueNotification(query, input.userId);
  return reviewId;
}

export async function openReviewsForMedia(query: Query, input: Omit<Parameters<typeof openFavoriteReview>[1], 'userId'> & { mediaId: string }) {
  const links = await query('SELECT DISTINCT user_id AS "userId",installation_id AS "installationId",bookmark_id AS "bookmarkId" FROM bookmark_media_link WHERE media_id=$1 AND status IN (\'matched\',\'accepted\',\'review\')', [input.mediaId]);
  for (const link of links.rows ?? []) await openFavoriteReview(query, { ...input, userId: String(link.userId), installationId: link.installationId, bookmarkId: link.bookmarkId });
}

export function isParenthesizedAmbiguity(alias: string, candidates: ReviewCandidate[]) {
  const exact = candidates.some(c => {
    const kind = exactTitleMatchKind(alias, String(c.title ?? ''));
    return kind === 'NORMALIZED_EXACT' || kind === 'COMPACT_EXACT';
  });
  const variant = candidates.some(c =>
    exactTitleMatchKind(alias, String(c.title ?? '')) === 'PARENTHESIZED_EXACT');
  return exact && variant;
}
