-- A manual provider choice belongs to the user's logical review cluster. Older
-- API versions persisted it only on the selected row, allowing a pending peer
-- to become the queue representative while the provider lookup was running or
-- after it exhausted its retries.
WITH queued AS (
  SELECT DISTINCT ON (
    source.user_id,
    COALESCE(source.cluster_id::text,source.id::text)
  )
    source.id,
    source.user_id,
    source.cluster_id,
    source.decision
  FROM favorite_review source
  WHERE source.status='PENDING'
    AND source.decision->>'kind'='manual-queued'
  ORDER BY
    source.user_id,
    COALESCE(source.cluster_id::text,source.id::text),
    source.created_at DESC,
    source.id DESC
)
UPDATE favorite_review pending
SET decision=queued.decision||jsonb_build_object('sourceReviewId',queued.id::text),
    reason='MANUAL_QUEUED'
FROM queued
WHERE pending.user_id=queued.user_id
  AND COALESCE(pending.cluster_id::text,pending.id::text)=COALESCE(queued.cluster_id::text,queued.id::text)
  AND pending.status='PENDING'
  AND pending.decision IS NULL;
