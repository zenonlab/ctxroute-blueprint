-- Reassess unresolved provider identities after the shared matcher learned to
-- treat a unique, substantial comma-delimited source prefix as bounded
-- evidence. Provider ordering and popularity remain irrelevant.
SELECT graphile_worker.add_job(
  'reassess-favorite-reviews','{"batch":100}'::json,
  job_key := 'review-reassess:provider-title-v15',
  max_attempts := 3,priority := -100,job_key_mode := 'replace'
);
