-- Reparse all active favorites after title-segment corroboration was added.
SELECT graphile_worker.add_job(
  'reassess-favorite-reviews','{"batch":100}'::json,
  job_key := 'review-reassess:favorite-parser-v5:provider-title-v9',
  max_attempts := 3,priority := -100,job_key_mode := 'replace'
);
