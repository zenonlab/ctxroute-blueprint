type Query = (sql: string, values?: unknown[]) => Promise<unknown>;
import { openReviewsForMedia, refreshReviewQueueNotification } from './favorite-review.js';

const REVIEWABLE_RESOLUTION_REASONS = new Set([
  'AMBIGUOUS','LOW_CONFIDENCE','NO_RESULT','NO_MATCH','TYPE_MISMATCH','FORMAT_MISMATCH','OVA_REQUIRED_NOT_FOUND',
]);
export function isReviewableResolutionReason(reason: string) {
  return REVIEWABLE_RESOLUTION_REASONS.has(reason);
}

/** Resolve against the shared catalogue before a provider request. Only one
 * exact, non-personal alias may win; partial matches deliberately stay review. */
export async function resolveLocalFavorite(
  query: Query,
  input: { mediaId: string; userId: string; type: string; aliases: string[] },
) {
  const aliases = [...new Set(input.aliases.map((x) => x.trim()).filter(Boolean))];
  if (!aliases.length) return null;
  const result: any = await query(
    `SELECT m.id AS "mediaId",
       EXISTS(SELECT 1 FROM media_metadata mm WHERE mm.media_id=m.id AND mm.status='ACTIVE' AND mm.provider IN ('anilist','mangaupdates','mangadex')) AS "resolved",
       EXISTS(SELECT 1 FROM media_external_id e WHERE e.media_id=m.id AND e.provider IN ('anilist','mangaupdates','mangadex')) AS "hasProviderId"
     FROM media m JOIN media_title t ON t.media_id=m.id
     WHERE m.type=$1 AND t.kind<>'personal' AND t.normalized_text = ANY($2::text[])
     GROUP BY m.id
     ORDER BY "resolved" DESC,"hasProviderId" DESC,m.id
     LIMIT 2`,
    [input.type, aliases],
  );
  if (!result.rows?.length) return null;
  // Two exact identities are ambiguous even if one currently has metadata.
  if (result.rows.length > 1) return null;
  return result.rows[0] as { mediaId: string; resolved: boolean; hasProviderId: boolean };
}

export async function markFavoriteUnresolved(query: Query, mediaId: string, reason: string) {
  if (!isReviewableResolutionReason(reason)) return false;
  await query(`UPDATE bookmark_media_link l SET status='review',evidence=evidence||$2::jsonb
    WHERE l.media_id=$1 AND l.status IN ('matched','accepted','review')
      AND NOT EXISTS(SELECT 1 FROM favorite_review r WHERE r.user_id=l.user_id AND r.installation_id=l.installation_id AND r.bookmark_id=l.bookmark_id AND r.status IN ('RESOLVED','NO_MATCH') AND r.decision IS NOT NULL)`, [mediaId, JSON.stringify({ resolution: 'unresolved', reason })]);
  await query("INSERT INTO personal_notification(user_id,release_key,kind,payload) SELECT user_id,$1,'FAVORITE_UNRESOLVED',jsonb_build_object('mediaId',$2::text,'reason',$3::text,'title','Favori à résoudre') FROM bookmark_media_link WHERE media_id=$2 AND status='review' ON CONFLICT(user_id,release_key,kind) DO NOTHING", [`favorite-unresolved|${mediaId}`, mediaId, reason]);
  const media = await query("SELECT type FROM media WHERE id=$1", [mediaId]) as any;
  const source = await query("SELECT text,provenance->>'sourceUrl' AS url FROM media_title WHERE media_id=$1 AND kind='source' ORDER BY id LIMIT 1", [mediaId]) as any;
  const provider = media.rows?.[0]?.type === 'ANIME' ? 'anilist' : 'mangaupdates';
  await openReviewsForMedia(query, { mediaId, provider, title: source.rows?.[0]?.text ?? mediaId, url: source.rows?.[0]?.url ?? '', candidates: [], reason });
  return true;
}

export async function markFavoriteMatched(query: Query, mediaId: string) {
  await query(`UPDATE bookmark_media_link l SET status='matched',evidence=evidence||jsonb_build_object('resolution','active-provider')
    WHERE l.media_id=$1 AND l.status IN ('review','matched','accepted')
      AND EXISTS(SELECT 1 FROM media_metadata mm WHERE mm.media_id=$1 AND mm.status='ACTIVE' AND mm.provider IN ('anilist','mangaupdates','mangadex'))
      AND NOT EXISTS(SELECT 1 FROM favorite_review r WHERE r.user_id=l.user_id AND r.installation_id=l.installation_id AND r.bookmark_id=l.bookmark_id AND r.status IN ('RESOLVED','NO_MATCH') AND r.decision IS NOT NULL)`, [mediaId]);
  await query(`DELETE FROM personal_notification
    WHERE kind='FAVORITE_UNRESOLVED'
      AND (payload->>'mediaId'=$1 OR payload->>'mediaId' IN (
        SELECT source_media_id FROM media_identity_merge WHERE target_media_id=$1
      ))`, [mediaId]);
}

/** Close stale provider-created reviews once the linked work has a durable
 * provider identity. User decisions are deliberately excluded. */
export async function reconcileResolvedFavoriteReviews(query: Query, mediaId: string, decisionKind = 'automatic-provider-resolution') {
  const users = new Set<string>();
  const updated: any = await query(`WITH eligible AS (
      SELECT r.id AS review_id,r.user_id,l.id AS link_id,l.media_id AS previous_media_id,
        l.status AS previous_status,mm.provider,mm.external_id
      FROM favorite_review r
      JOIN bookmark_media_link l ON l.user_id=r.user_id
        AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id
      JOIN media_metadata mm ON mm.media_id=$1
        AND (mm.provider=r.provider OR ($2='mangadex-valid-resolution' AND mm.provider='mangadex' AND r.provider='mangaupdates'))
        AND mm.status='ACTIVE' AND mm.external_id IS NOT NULL
      WHERE r.status='PENDING' AND r.decision IS NULL
        AND l.status IN ('matched','accepted','review')
        AND (l.media_id=$1 OR EXISTS (
          SELECT 1 FROM media_identity_merge merge
          WHERE merge.source_media_id=l.media_id AND merge.target_media_id=$1
        ))
      FOR UPDATE OF r,l
    ), linked AS (
      UPDATE bookmark_media_link link SET media_id=$1,status='matched',
        evidence=link.evidence||jsonb_build_object('automaticReviewReconciliation',jsonb_build_object(
          'reviewId',eligible.review_id::text,'kind',$2::text,'provider',eligible.provider,
          'externalId',eligible.external_id,'previousMediaId',eligible.previous_media_id,
          'previousStatus',eligible.previous_status,'targetMediaId',$1::text))
      FROM eligible WHERE link.id=eligible.link_id
      RETURNING eligible.review_id,eligible.user_id,eligible.provider,eligible.external_id
    )
    UPDATE favorite_review review SET status='RESOLVED',
      decision=jsonb_build_object('kind',$2::text,'provider',linked.provider,'externalId',linked.external_id,'mediaId',$1::text),
      resolved_at=now()
    FROM linked WHERE review.id=linked.review_id AND review.status='PENDING' AND review.decision IS NULL
    RETURNING review.user_id AS "userId"`, [mediaId, decisionKind]);
  for (const result of updated.rows ?? []) users.add(String(result.userId));
  for (const userId of users) await refreshReviewQueueNotification(query, userId);
}
