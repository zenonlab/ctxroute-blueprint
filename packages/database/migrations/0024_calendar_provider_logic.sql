-- One AniList episode is one mutable scheduled event. A schedule correction
-- moves it; it must not create another calendar entry.
WITH ranked AS (
  SELECT id,row_number() OVER (
    PARTITION BY media_id,provider,episode
    ORDER BY last_verified_at DESC,airing_at_utc DESC,id DESC
  ) AS position
  FROM media_airing
)
DELETE FROM media_airing airing USING ranked
WHERE airing.id=ranked.id AND ranked.position>1;

ALTER TABLE media_airing
  DROP CONSTRAINT IF EXISTS media_airing_media_id_provider_episode_airing_at_utc_key;
DROP INDEX IF EXISTS media_airing_identity_unique;
CREATE UNIQUE INDEX IF NOT EXISTS media_airing_identity_unique
  ON media_airing(media_id,provider,episode);
