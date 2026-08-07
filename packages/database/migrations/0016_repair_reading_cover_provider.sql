-- AniList was incorrectly used as a fallback for reading covers. Keep the
-- image assets, but make only those active links eligible for a MangaUpdates
-- cover retry. Anime covers are untouched.
UPDATE media_cover c
SET status='STALE', error='READING_COVER_PROVIDER_REPAIR'
FROM media m
WHERE m.id=c.media_id
  AND m.type IN ('MANGA','MANHWA','MANHUA')
  AND c.provider='anilist'
  AND c.status='ACTIVE';
