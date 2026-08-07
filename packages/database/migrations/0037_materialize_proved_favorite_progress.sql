-- One-time catch-up for evidence parsed before its resolved bookmark link was
-- materialized. The existing trigger remains the sole writer policy: it keeps
-- the maximum position, preserves provenance, and never regresses progress.
UPDATE bookmark_media_link link
SET status = link.status
WHERE link.status IN ('matched', 'accepted')
  AND link.media_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM bookmark_import_item item
    WHERE item.user_id = link.user_id
      AND item.installation_id = link.installation_id
      AND item.bookmark_id = link.bookmark_id
      AND item.event <> 'removed'
  )
  AND EXISTS (
    SELECT 1
    FROM favorite_progress_candidate candidate
    WHERE candidate.user_id = link.user_id
      AND candidate.installation_id = link.installation_id
      AND candidate.bookmark_id = link.bookmark_id
  );
