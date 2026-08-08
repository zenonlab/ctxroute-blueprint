-- Reparse active favorites so paginated catalogue index files are excluded as
-- utility pages instead of materialized as source identities.
SELECT graphile_worker.add_job(
  'reassess-favorite-reviews','{"batch":100}'::json,
  job_key := 'review-reassess:favorite-parser-v7:provider-title-v14',
  max_attempts := 3,priority := -100,job_key_mode := 'replace'
);
