-- The shared query generator now discovers the same bounded comma-delimited
-- prefix that the provider-neutral matcher can evaluate. Both provider
-- connector versions advance together so v29 NO_MATCH states are not reused.
SELECT graphile_worker.add_job(
  'enrichment-sweep','{}'::json,
  job_key := 'enrichment-sweep:provider-title-v15-shared-discovery-v30',
  max_attempts := 3,priority := -100,job_key_mode := 'replace'
);
