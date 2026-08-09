export type RepairQuery = (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

export type ResolvedReviewRepairProof = {
  linkId: string; reviewId: string | null; userId: string; installationId: string;
  bookmarkId: string; previousMediaId: string | null; targetMediaId: string;
  previousStatus: string; provider: string; providerId: string;
};

const reviewEvidenceCte = `WITH review_evidence AS (
  SELECT r.id AS review_id,r.user_id,r.installation_id,r.bookmark_id,r.provider,r.status,
    r.selected_candidate_id,r.decision,c.id AS candidate_id,c.media_id AS candidate_media_id,
    CASE WHEN c.id IS NOT NULL THEN c.provider_id
      ELSE COALESCE(NULLIF(r.decision->>'externalId',''),NULLIF(r.decision->>'providerId','')) END AS provider_id,
    NULLIF(r.decision->>'mediaId','') AS decision_media_id
  FROM favorite_review r
  LEFT JOIN favorite_review_candidate c ON c.id=r.selected_candidate_id
  WHERE r.status='RESOLVED' AND r.decision IS NOT NULL
    AND r.provider IN ('anilist','mangaupdates')
), validated AS (
  SELECT evidence.*,external.media_id AS mapped_media_id
  FROM review_evidence evidence
  JOIN media_external_id external ON external.provider=evidence.provider AND external.external_id=evidence.provider_id
  JOIN media target ON target.id=external.media_id
  WHERE (evidence.candidate_id IS NOT NULL OR (
      evidence.selected_candidate_id IS NULL
      AND evidence.decision->>'kind'='automatic-provider-resolution'
      AND evidence.decision->>'provider'=evidence.provider
    ))
    AND (evidence.candidate_media_id IS NULL OR evidence.candidate_media_id=external.media_id)
    AND (evidence.decision_media_id IS NULL OR evidence.decision_media_id=external.media_id)
), authority AS (
  SELECT *,mapped_media_id AS target_media_id FROM validated
), merge_authority AS (
  SELECT merge.source_media_id,merge.target_media_id,merge.provider,merge.external_id AS provider_id
  FROM media_identity_merge merge
  JOIN media_external_id external ON external.provider=merge.provider
    AND external.external_id=merge.external_id AND external.media_id=merge.target_media_id
  JOIN media_metadata metadata ON metadata.media_id=merge.target_media_id
    AND metadata.provider=merge.provider AND metadata.external_id=merge.external_id AND metadata.status='ACTIVE'
  WHERE merge.provider IN ('anilist','mangaupdates')
)`;

export const resolvedReviewRepairPreviewSql = `${reviewEvidenceCte}
SELECT l.id AS "linkId",a.review_id AS "reviewId",l.user_id AS "userId",
  l.installation_id AS "installationId",l.bookmark_id AS "bookmarkId",
  l.media_id AS "previousMediaId",a.target_media_id AS "targetMediaId",
  l.status AS "previousStatus",a.provider,a.provider_id AS "providerId"
FROM authority a
JOIN bookmark_media_link l ON l.user_id=a.user_id AND l.installation_id=a.installation_id AND l.bookmark_id=a.bookmark_id
WHERE a.target_media_id IS NOT NULL
  AND l.status IN ('matched','accepted','review')
  AND (l.media_id IS DISTINCT FROM a.target_media_id OR l.status<>'matched')
ORDER BY a.review_id,l.id`;

export const mergedIdentityRepairPreviewSql = `${reviewEvidenceCte}
SELECT l.id AS "linkId",NULL::uuid AS "reviewId",l.user_id AS "userId",
  l.installation_id AS "installationId",l.bookmark_id AS "bookmarkId",
  l.media_id AS "previousMediaId",authority.target_media_id AS "targetMediaId",
  l.status AS "previousStatus",authority.provider,authority.provider_id AS "providerId"
FROM merge_authority authority
JOIN bookmark_media_link l ON l.media_id=authority.source_media_id
WHERE l.status IN ('matched','accepted','review')
  AND NOT EXISTS(SELECT 1 FROM favorite_review terminal
    WHERE terminal.user_id=l.user_id AND terminal.installation_id=l.installation_id
      AND terminal.bookmark_id=l.bookmark_id AND terminal.status IN ('RESOLVED','NO_MATCH') AND terminal.decision IS NOT NULL)
ORDER BY l.id`;

export const resolvedReviewRepairAnomalySql = `${reviewEvidenceCte}
SELECT evidence.review_id AS "reviewId",evidence.user_id AS "userId",evidence.provider,evidence.status,
  evidence.selected_candidate_id AS "selectedCandidateId",evidence.provider_id AS "providerId",
  evidence.candidate_media_id AS "candidateMediaId",external.media_id AS "externalMediaId",
  CASE
    WHEN evidence.selected_candidate_id IS NOT NULL AND evidence.candidate_id IS NULL THEN 'SELECTED_CANDIDATE_NOT_FOUND'
    WHEN evidence.selected_candidate_id IS NULL AND evidence.decision->>'kind' IS DISTINCT FROM 'automatic-provider-resolution' THEN 'MISSING_SELECTED_CANDIDATE'
    WHEN evidence.selected_candidate_id IS NULL AND evidence.decision->>'provider' IS DISTINCT FROM evidence.provider THEN 'DECISION_PROVIDER_MISMATCH'
    WHEN evidence.provider_id IS NULL THEN 'DECISION_PROVIDER_ID_MISSING'
    WHEN external.media_id IS NULL THEN 'CANONICAL_TARGET_NOT_FOUND'
    WHEN evidence.candidate_media_id IS NOT NULL AND evidence.candidate_media_id<>external.media_id THEN 'CONFLICTING_CANONICAL_TARGETS'
    WHEN evidence.decision_media_id IS NOT NULL AND evidence.decision_media_id<>external.media_id THEN 'CONFLICTING_DECISION_TARGET'
  END AS reason
FROM review_evidence evidence
LEFT JOIN media_external_id external ON external.provider=evidence.provider AND external.external_id=evidence.provider_id
WHERE (evidence.selected_candidate_id IS NOT NULL AND evidence.candidate_id IS NULL)
   OR (evidence.selected_candidate_id IS NULL AND evidence.decision->>'kind' IS DISTINCT FROM 'automatic-provider-resolution')
   OR (evidence.selected_candidate_id IS NULL AND evidence.decision->>'provider' IS DISTINCT FROM evidence.provider)
   OR evidence.provider_id IS NULL OR external.media_id IS NULL
   OR (evidence.candidate_media_id IS NOT NULL AND evidence.candidate_media_id<>external.media_id)
   OR (evidence.decision_media_id IS NOT NULL AND evidence.decision_media_id<>external.media_id)
ORDER BY evidence.review_id`;

export const repairPreservationSnapshotSql = `SELECT jsonb_build_object(
  'imports',(SELECT jsonb_build_object('count',count(*),'hash',md5(COALESCE(string_agg(row_to_json(i)::text,'|' ORDER BY i.id),''))) FROM bookmark_import_item i),
  'linkInventory',(SELECT jsonb_build_object('count',count(*),'hash',md5(COALESCE(string_agg(concat_ws('|',l.id,l.user_id,l.installation_id,l.bookmark_id,l.classifier_version),'|' ORDER BY l.id),''))) FROM bookmark_media_link l),
  'titles',(SELECT jsonb_build_object('count',count(*),'hash',md5(COALESCE(string_agg(row_to_json(t)::text,'|' ORDER BY t.id),''))) FROM media_title t),
  'progressCandidates',(SELECT jsonb_build_object('count',count(*),'hash',md5(COALESCE(string_agg(concat_ws('|',p.id,p.user_id,p.installation_id,p.bookmark_id,p.position_kind,p.position_number,p.position_raw,p.raw_title,p.raw_url,p.parsed_slug,p.path_segments::text,p.evidence::text),'|' ORDER BY p.id),''))) FROM favorite_progress_candidate p),
  'origins',(SELECT jsonb_build_object('count',count(*),'hash',md5(COALESCE(string_agg(row_to_json(o)::text,'|' ORDER BY o.id),''))) FROM release_origin o)
) AS snapshot`;

export async function previewResolvedReviewRepair(query: RepairQuery) {
  const changes = await query(resolvedReviewRepairPreviewSql);
  const mergedChanges = await query(mergedIdentityRepairPreviewSql);
  const anomalies = await query(resolvedReviewRepairAnomalySql);
  return { changes: [...changes.rows,...mergedChanges.rows] as ResolvedReviewRepairProof[], anomalies: anomalies.rows };
}

export async function applyResolvedReviewRepairBatch(query: RepairQuery, batchSize: number) {
  const result = await query(`${reviewEvidenceCte}, eligible_raw AS (
    SELECT l.id,a.review_id,a.target_media_id,a.provider,a.provider_id
    FROM authority a JOIN bookmark_media_link l
      ON l.user_id=a.user_id AND l.installation_id=a.installation_id AND l.bookmark_id=a.bookmark_id
    WHERE a.target_media_id IS NOT NULL AND l.status IN ('matched','accepted','review')
      AND (l.media_id IS DISTINCT FROM a.target_media_id OR l.status<>'matched')
    UNION ALL
    SELECT l.id,NULL::uuid,merge.target_media_id,merge.provider,merge.provider_id
    FROM merge_authority merge JOIN bookmark_media_link l ON l.media_id=merge.source_media_id
    WHERE l.status IN ('matched','accepted','review')
      AND NOT EXISTS(SELECT 1 FROM favorite_review terminal
        WHERE terminal.user_id=l.user_id AND terminal.installation_id=l.installation_id
          AND terminal.bookmark_id=l.bookmark_id AND terminal.status IN ('RESOLVED','NO_MATCH') AND terminal.decision IS NOT NULL)
  ), eligible AS (
    SELECT id,min(review_id::text)::uuid AS review_id,min(target_media_id) AS target_media_id,
      min(provider) AS provider,min(provider_id) AS provider_id
    FROM eligible_raw GROUP BY id HAVING count(DISTINCT target_media_id)=1
  ), candidates AS (
    SELECT l.id,eligible.review_id,eligible.target_media_id,eligible.provider,eligible.provider_id,
      l.media_id AS previous_media_id,l.status AS previous_status
    FROM eligible JOIN bookmark_media_link l ON l.id=eligible.id
    ORDER BY l.id LIMIT $1 FOR UPDATE OF l SKIP LOCKED
  )
  UPDATE bookmark_media_link l SET media_id=c.target_media_id,status='matched',
    evidence=l.evidence||jsonb_build_object('resolvedReviewRepair',jsonb_build_object(
      'reviewId',c.review_id::text,'authority',CASE WHEN c.review_id IS NULL THEN 'validated-media-identity-merge' ELSE 'resolved-review' END,
      'provider',c.provider,'providerId',c.provider_id,
      'previousMediaId',c.previous_media_id,'previousStatus',c.previous_status,'targetMediaId',c.target_media_id))
  FROM candidates c WHERE l.id=c.id
  RETURNING l.id AS "linkId",c.review_id AS "reviewId",l.user_id AS "userId",
    l.installation_id AS "installationId",l.bookmark_id AS "bookmarkId",
    c.previous_media_id AS "previousMediaId",c.target_media_id AS "targetMediaId",
    c.previous_status AS "previousStatus",c.provider,c.provider_id AS "providerId"`, [batchSize]);
  return result.rows as ResolvedReviewRepairProof[];
}
