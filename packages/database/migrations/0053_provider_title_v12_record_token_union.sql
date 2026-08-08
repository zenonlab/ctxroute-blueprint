-- Reassess unresolved clusters after bounded token evidence learned to combine
-- titles belonging to one provider identity, never across separate results.
SELECT graphile_worker.add_job(
  'reassess-favorite-reviews','{"batch":100}'::json,
  job_key := 'review-reassess:provider-title-v12',
  max_attempts := 3,priority := -100,job_key_mode := 'replace'
);
