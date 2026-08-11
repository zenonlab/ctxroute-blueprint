-- AniList alone may use independently corroborated explicit season evidence.
-- Reassess unresolved identities and stale AniList enrichment states after S4
-- became equivalent to the already-supported Season 4 / Saison 4 markers.
SELECT graphile_worker.add_job(
  'reassess-favorite-reviews','{"batch":100}'::json,
  job_key := 'review-reassess:provider-title-v16',
  max_attempts := 3,priority := -100,job_key_mode := 'replace'
);
SELECT graphile_worker.add_job(
  'enrichment-sweep','{}'::json,
  job_key := 'enrichment-sweep:provider-title-v16-anilist-v31',
  max_attempts := 3,priority := -100,job_key_mode := 'replace'
);
