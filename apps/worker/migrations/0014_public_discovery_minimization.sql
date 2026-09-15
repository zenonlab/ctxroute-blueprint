ALTER TABLE public_discovery_requests_v2 ADD COLUMN purge_after TEXT;
ALTER TABLE public_discovery_result_nonces_v2 ADD COLUMN purge_after TEXT;

CREATE TABLE catalogue_canonical_titles_v1 (
  normalization_version TEXT NOT NULL,
  normalized_title TEXT NOT NULL,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('anime', 'manga')),
  work_id TEXT NOT NULL REFERENCES catalogue_works(work_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  PRIMARY KEY (normalization_version, normalized_title, media_kind),
  UNIQUE (work_id, normalization_version, normalized_title)
) STRICT;

CREATE INDEX catalogue_canonical_titles_v1_by_work
  ON catalogue_canonical_titles_v1(work_id, normalization_version, normalized_title);

CREATE INDEX public_discovery_v2_failed_retention
  ON public_discovery_requests_v2(purge_after, updated_at)
  WHERE state = 'FAILED' AND purge_after IS NOT NULL;

CREATE INDEX public_discovery_v2_nonce_retention
  ON public_discovery_result_nonces_v2(purge_after, created_at)
  WHERE purge_after IS NOT NULL;

PRAGMA optimize;
