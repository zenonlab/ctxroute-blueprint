-- Reparse active favorites after opaque URL identities learned to consume one
-- uniquely cleaned human title segment. Raw URL/title provenance is retained.
SELECT graphile_worker.add_job(
  'reassess-favorite-reviews','{"batch":100}'::json,
  job_key := 'review-reassess:favorite-parser-v6:provider-title-v10',
  max_attempts := 3,priority := -100,job_key_mode := 'replace'
);
