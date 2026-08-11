-- Matching semantics changed symmetrically for both canonical providers.
-- The v29 connector versions make old terminal/no-match states stale; this
-- bounded sweep discovers them through the normal user-scoped enrichment lane.
SELECT graphile_worker.add_job(
  'enrichment-sweep','{}'::json,
  job_key := 'enrichment-sweep:provider-title-v15-connectors-v29',
  max_attempts := 3,priority := -100,job_key_mode := 'replace'
);
