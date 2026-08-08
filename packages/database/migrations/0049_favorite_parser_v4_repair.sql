-- Idempotent parser+matcher repair ledger. Raw favorite data remains owned by
-- bookmark_import_item; the ledger deliberately stores no title or URL.
CREATE TABLE IF NOT EXISTS favorite_parser_repair (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  bookmark_id text NOT NULL,
  parser_id text NOT NULL,
  matcher_version text NOT NULL,
  status text NOT NULL CHECK(status IN ('COMPLETED','ERROR')),
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,installation_id,bookmark_id,parser_id,matcher_version)
);

SELECT graphile_worker.add_job(
  'reassess-favorite-reviews','{}'::json,
  job_key := 'review-reassess:favorite-parser-v4:provider-title-v8',
  max_attempts := 3,job_key_mode := 'replace'
);
