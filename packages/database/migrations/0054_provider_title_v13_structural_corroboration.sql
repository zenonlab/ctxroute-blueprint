-- Provider candidates may corroborate the exact middle of a structurally
-- wrapped URL alias. No wrapper is removed from URL evidence alone.
SELECT graphile_worker.add_job(
  'reassess-favorite-reviews','{"batch":100}'::json,
  job_key := 'review-reassess:provider-title-v13',
  max_attempts := 3,priority := -100,job_key_mode := 'replace'
);
