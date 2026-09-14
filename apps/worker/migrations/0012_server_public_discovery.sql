CREATE TABLE public_discovery_requests_v2 (
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  media_kind TEXT NOT NULL CHECK (media_kind IN ('ANIME', 'MANGA', 'MANHWA', 'MANHUA', 'UNKNOWN')),
  parser_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  request_digest TEXT NOT NULL CHECK (length(request_digest) = 64),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  state TEXT NOT NULL CHECK (state IN ('PENDING', 'PROCESSING', 'VERIFIED', 'NOT_FOUND', 'AMBIGUOUS')),
  claim_token_hash TEXT,
  lease_until TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 8),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  retry_at TEXT NOT NULL,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (fingerprint, media_kind, parser_version, rules_version),
  CHECK ((state IN ('VERIFIED', 'NOT_FOUND', 'AMBIGUOUS')) = (result_json IS NOT NULL AND verified_at IS NOT NULL))
) STRICT;

CREATE INDEX public_discovery_v2_pending
  ON public_discovery_requests_v2(state, retry_at, updated_at)
  WHERE state IN ('PENDING', 'PROCESSING');

CREATE TABLE public_discovery_result_nonces_v2 (
  nonce TEXT PRIMARY KEY,
  result_digest TEXT NOT NULL CHECK (length(result_digest) = 64),
  created_at TEXT NOT NULL
) STRICT;

PRAGMA optimize;
