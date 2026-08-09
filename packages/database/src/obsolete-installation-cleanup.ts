export type CleanupQuery = (sql: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }>;

export const obsoleteInstallationPreviewSql = `SELECT d.id AS "deviceId",d.user_id AS "userId",
  d.installation_id AS "installationId",d.revoked_at AS "revokedAt",
  (SELECT count(*)::int FROM bookmark_import_item i WHERE i.user_id=d.user_id AND i.installation_id=d.installation_id) AS "importCount",
  (SELECT count(*)::int FROM bookmark_media_link l WHERE l.user_id=d.user_id AND l.installation_id=d.installation_id AND l.status IN ('matched','accepted','review')) AS "activeLinkCount",
  (SELECT count(*)::int FROM bookmark_media_link l WHERE l.user_id=d.user_id AND l.installation_id=d.installation_id AND l.status='removed') AS "removedLinkCount",
  (SELECT count(*)::int FROM favorite_review r WHERE r.user_id=d.user_id AND r.installation_id=d.installation_id) AS "reviewCount",
  (SELECT count(*)::int FROM favorite_review r WHERE r.user_id=d.user_id AND r.installation_id=d.installation_id AND r.decision IS NOT NULL) AS "decisionCount",
  (SELECT count(*)::int FROM favorite_review_candidate c JOIN favorite_review r ON r.id=c.review_id WHERE r.user_id=d.user_id AND r.installation_id=d.installation_id) AS "candidateCount",
  (SELECT count(*)::int FROM favorite_review r JOIN bookmark_media_link l ON l.user_id=r.user_id AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id WHERE r.user_id=d.user_id AND r.installation_id=d.installation_id AND r.status='PENDING' AND l.status IN ('matched','accepted','review')) AS "visiblePendingReviewCount",
  (SELECT count(*)::int FROM favorite_progress_candidate p WHERE p.user_id=d.user_id AND p.installation_id=d.installation_id) AS "progressCandidateCount",
  (SELECT count(DISTINCT l.media_id)::int FROM bookmark_media_link l WHERE l.user_id=d.user_id AND l.installation_id=d.installation_id AND l.status IN ('matched','accepted','review')) AS "visibleMediaCount"
FROM extension_device d WHERE d.user_id=$1::uuid AND d.installation_id=$2`;

export const obsoleteInstallationIdentityChecksSql = `SELECT l.bookmark_id AS "bookmarkId",l.media_id AS "mediaId",l.status,
  merge.target_media_id AS "mergedTargetMediaId",
  (SELECT max(candidate.position_number) FROM favorite_progress_candidate candidate
    WHERE candidate.user_id=l.user_id AND candidate.installation_id=l.installation_id AND candidate.bookmark_id=l.bookmark_id) AS "strongestProgressCandidate"
FROM bookmark_media_link l
LEFT JOIN media_identity_merge merge ON merge.source_media_id=l.media_id
WHERE l.user_id=$1::uuid AND l.installation_id=$2
ORDER BY l.bookmark_id,l.id`;

export async function previewObsoleteInstallationCleanup(query: CleanupQuery, userId: string, installationId: string) {
  const summary = await query(obsoleteInstallationPreviewSql, [userId, installationId]);
  if (summary.rows.length !== 1) throw new Error('SCOPED_INSTALLATION_NOT_FOUND');
  const checks = await query(obsoleteInstallationIdentityChecksSql, [userId, installationId]);
  return { summary: summary.rows[0], identityAndProgressionChecks: checks.rows };
}

export async function applyObsoleteInstallationCleanup(query: CleanupQuery, userId: string, installationId: string) {
  const device = await query(`UPDATE extension_device SET revoked_at=COALESCE(revoked_at,now())
    WHERE user_id=$1::uuid AND installation_id=$2 RETURNING id AS "deviceId",revoked_at AS "revokedAt"`, [userId, installationId]);
  if (device.rows.length !== 1) throw new Error('SCOPED_INSTALLATION_NOT_FOUND');
  const links = await query(`UPDATE bookmark_media_link SET status='removed',
      evidence=evidence||jsonb_build_object('obsoleteInstallationCleanup',jsonb_build_object(
        'installationId',$2::text,'previousStatus',status,'appliedAt',now()))
    WHERE user_id=$1::uuid AND installation_id=$2 AND status IN ('matched','accepted','review')
    RETURNING id`, [userId, installationId]);
  const pending = await query(`SELECT count(DISTINCT COALESCE(r.cluster_id::text,r.id::text))::int AS count
    FROM favorite_review r JOIN bookmark_media_link l ON l.user_id=r.user_id
      AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id
    WHERE r.user_id=$1::uuid AND r.status='PENDING' AND l.status IN ('matched','accepted','review')`, [userId]);
  const pendingCount = Number(pending.rows[0]?.count ?? 0);
  if (pendingCount === 0) {
    await query("DELETE FROM personal_notification WHERE user_id=$1::uuid AND kind='FAVORITE_REVIEW_REQUIRED' AND release_key='favorite-review-queue'", [userId]);
  } else {
    await query(`UPDATE personal_notification SET payload=payload||jsonb_build_object('count',$2::int),read_at=NULL
      WHERE user_id=$1::uuid AND kind='FAVORITE_REVIEW_REQUIRED' AND release_key='favorite-review-queue'`, [userId, pendingCount]);
  }
  return { device: device.rows[0], removedLinkCount: links.rowCount ?? links.rows.length, pendingReviewCount: pendingCount };
}
