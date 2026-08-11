-- AniList explicit-season corroboration now preserves punctuation that belongs
-- to the identity base and recognizes provider-native ordinal season markers.
-- Reassess unresolved reviews and refresh stale AniList projections generically.
SELECT graphile_worker.add_job(
  'reassess-favorite-reviews','{"batch":100}'::json,
  job_key := 'review-reassess:provider-title-v17',
  max_attempts := 3,priority := -100,job_key_mode := 'replace'
);
SELECT graphile_worker.add_job(
  'enrichment-sweep','{}'::json,
  job_key := 'enrichment-sweep:provider-title-v17-anilist-v32',
  max_attempts := 3,priority := -100,job_key_mode := 'replace'
);
