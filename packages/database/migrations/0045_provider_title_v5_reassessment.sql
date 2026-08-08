-- Re-run unresolved provider reviews after grammar-token matching changes.
-- The matcher-version ledger keeps this bounded and idempotent without
-- rewriting personal input or user decisions.
SELECT graphile_worker.add_job(
  'reassess-favorite-reviews',
  '{}'::json,
  job_key := 'review-reassess:provider-title-v5',
  max_attempts := 3,
  job_key_mode := 'replace'
);
