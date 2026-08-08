-- Reassess unresolved clusters after symmetric functional-word and inflection
-- normalization. Popularity and provider result order remain non-evidence.
SELECT graphile_worker.add_job(
  'reassess-favorite-reviews','{"batch":100}'::json,
  job_key := 'review-reassess:provider-title-v11',
  max_attempts := 3,priority := -100,job_key_mode := 'replace'
);
