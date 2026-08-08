-- Reassess only automatic reviews after bounding edit distance relative to
-- title length. Provider popularity and ordering remain outside identity.
SELECT graphile_worker.add_job(
  'reassess-favorite-reviews','{}'::json,
  job_key := 'review-reassess:provider-title-v7',max_attempts := 3,
  priority := -100,job_key_mode := 'replace'
);
