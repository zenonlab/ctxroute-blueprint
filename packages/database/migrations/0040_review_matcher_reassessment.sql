-- Bounded, resumable reassessment ledger. It stores no favorite title or URL.
CREATE TABLE IF NOT EXISTS review_matcher_reassessment (
  cluster_id uuid NOT NULL REFERENCES review_title_cluster(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK(provider IN ('anilist','mangaupdates')),
  matcher_version text NOT NULL,
  status text NOT NULL CHECK(status IN ('QUEUED','COMPLETED','ERROR')),
  examined_count integer NOT NULL DEFAULT 0,
  resolved_count integer NOT NULL DEFAULT 0,
  ambiguity_count integer NOT NULL DEFAULT 0,
  no_result_count integer NOT NULL DEFAULT 0,
  attempt_count integer NOT NULL DEFAULT 1,
  last_error_code text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(cluster_id,provider,matcher_version)
);
CREATE INDEX IF NOT EXISTS review_matcher_reassessment_status_idx
  ON review_matcher_reassessment(status,updated_at,cluster_id);
