CREATE TABLE catalogue_release_model (
  work_id TEXT PRIMARY KEY REFERENCES catalogue_works(work_id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('anilist', 'mangaupdates')),
  provider_work_id TEXT NOT NULL,
  release_kind TEXT NOT NULL CHECK (release_kind IN ('episode', 'chapter', 'volume', 'special')),
  anchor_date TEXT NOT NULL,
  anchor_sequence TEXT,
  interval_days REAL CHECK (interval_days IS NULL OR interval_days > 0),
  explicit_next_json TEXT CHECK (explicit_next_json IS NULL OR json_valid(explicit_next_json)),
  exceptions_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(exceptions_json) AND json_array_length(exceptions_json) <= 32),
  valid_from TEXT NOT NULL,
  valid_to TEXT NOT NULL,
  editorial_status TEXT NOT NULL CHECK (editorial_status IN ('UPCOMING', 'ONGOING', 'HIATUS', 'COMPLETED', 'CANCELLED', 'UNKNOWN')),
  source TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  model_digest TEXT NOT NULL CHECK (length(model_digest) = 64),
  revision INTEGER NOT NULL REFERENCES catalogue_revisions(revision)
) STRICT;

CREATE INDEX catalogue_release_model_validity
  ON catalogue_release_model(valid_from, valid_to, work_id);

PRAGMA optimize;
