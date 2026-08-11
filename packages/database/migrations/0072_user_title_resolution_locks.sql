-- A user answer is durable for a parsed-title group.  Reviews remain the
-- audit trail; this table is only the current answer used during re-import.
-- The bounded pending-review repair below intentionally reapplies an existing
-- user decision, so it is the one migration allowed through the immutable
-- link guard (the transaction is rolled back on any failure).
SELECT set_config('favlib.resolved_review_repair','on',true);
CREATE TABLE user_title_resolution_lock (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  cluster_key text NOT NULL,
  provider text NOT NULL CHECK(provider IN ('anilist','mangaupdates')),
  outcome text NOT NULL CHECK(outcome IN ('MATCH','NO_MATCH')),
  profile_id uuid REFERENCES provider_profile(id) ON DELETE RESTRICT,
  media_id text REFERENCES media(id) ON DELETE RESTRICT,
  source_review_id uuid NOT NULL REFERENCES favorite_review(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,cluster_key),
  CHECK((outcome='MATCH' AND media_id IS NOT NULL) OR (outcome='NO_MATCH' AND media_id IS NULL))
);
CREATE INDEX user_title_resolution_lock_media_idx ON user_title_resolution_lock(user_id,media_id);

-- Preserve historical reviews, but make the latest actual user answer the
-- current lock. Automatic provider reconciliation and prior reuse are not
-- user answers and therefore cannot establish a lock.
INSERT INTO user_title_resolution_lock(user_id,cluster_key,provider,outcome,profile_id,media_id,source_review_id,created_at,updated_at)
SELECT DISTINCT ON (r.user_id,c.cluster_key)
  r.user_id,c.cluster_key,r.provider,
  CASE WHEN r.status='NO_MATCH' THEN 'NO_MATCH' ELSE 'MATCH' END,
  chosen.profile_id,CASE WHEN r.status='NO_MATCH' THEN NULL ELSE COALESCE(NULLIF(r.decision->>'mediaId',''),l.media_id) END,
  r.id,r.resolved_at,r.resolved_at
FROM favorite_review r
JOIN review_title_cluster c ON c.id=r.cluster_id
LEFT JOIN bookmark_media_link l ON l.user_id=r.user_id AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id
LEFT JOIN favorite_review_candidate chosen ON chosen.id=r.selected_candidate_id
WHERE r.status IN ('RESOLVED','NO_MATCH') AND r.decision IS NOT NULL
  AND COALESCE(r.decision->>'kind','') IN ('candidate','manual','no-match','anime-chain-choice')
  AND (r.status='NO_MATCH' OR COALESCE(NULLIF(r.decision->>'mediaId',''),l.media_id) IS NOT NULL)
ORDER BY r.user_id,c.cluster_key,r.resolved_at DESC NULLS LAST,r.id DESC
ON CONFLICT(user_id,cluster_key) DO UPDATE SET outcome=excluded.outcome,profile_id=excluded.profile_id,media_id=excluded.media_id,source_review_id=excluded.source_review_id,updated_at=excluded.updated_at;

-- Close already-open questions covered by a durable user answer.  This is
-- intentionally limited to a matching parsed-title cluster and user.
WITH covered AS (
  SELECT r.id,r.user_id,r.status,lock.outcome,lock.profile_id,lock.media_id,lock.source_review_id
  FROM favorite_review r JOIN review_title_cluster c ON c.id=r.cluster_id
  JOIN user_title_resolution_lock lock ON lock.user_id=r.user_id AND lock.cluster_key=c.cluster_key
  WHERE r.status='PENDING' AND r.decision IS NULL
), linked AS (
  UPDATE bookmark_media_link l SET media_id=covered.media_id,status='matched',
    evidence=l.evidence||jsonb_build_object('resolution','user-title-lock','sourceReviewId',covered.source_review_id::text)
  FROM covered WHERE covered.outcome='MATCH' AND l.user_id=covered.user_id
    AND EXISTS(SELECT 1 FROM favorite_review r WHERE r.id=covered.id AND r.installation_id=l.installation_id AND r.bookmark_id=l.bookmark_id)
    -- Never rewrite a link already protected by an earlier resolved decision;
    -- the lock only closes the stale question in that case.
    AND NOT EXISTS(SELECT 1 FROM favorite_review resolved WHERE resolved.user_id=l.user_id AND resolved.installation_id=l.installation_id
      AND resolved.bookmark_id=l.bookmark_id AND resolved.status IN ('RESOLVED','NO_MATCH') AND resolved.decision IS NOT NULL)
  RETURNING l.user_id,l.installation_id,l.bookmark_id
)
UPDATE favorite_review r SET status=CASE WHEN covered.outcome='MATCH' THEN 'RESOLVED' ELSE 'NO_MATCH' END,decision=jsonb_build_object('kind','user-title-lock-reuse','sourceReviewId',covered.source_review_id::text,'mediaId',covered.media_id),resolved_at=now()
FROM covered WHERE r.id=covered.id;
