-- Reparse raw active favorites with the shared release-badge and repeated-title
-- corroboration policy. The versioned repair ledger keeps this idempotent.
SELECT graphile_worker.add_job(
  'reassess-favorite-reviews','{"batch":100}'::json,
  job_key := 'review-reassess:favorite-parser-v8:provider-title-v14',
  max_attempts := 3,priority := -100,job_key_mode := 'replace'
);
