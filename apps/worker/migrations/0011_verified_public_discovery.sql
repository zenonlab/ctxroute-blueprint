CREATE TABLE public_discovery_claims (
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  media_kind TEXT NOT NULL CHECK (media_kind IN ('ANIME', 'MANGA', 'MANHWA', 'MANHUA', 'UNKNOWN')),
  parser_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PENDING_SEARCH', 'PENDING_VERIFICATION', 'VERIFIED')),
  lease_token_hash TEXT,
  lease_until TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 8),
  references_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(references_json)),
  proposal_digest TEXT,
  profile_json TEXT CHECK (profile_json IS NULL OR json_valid(profile_json)),
  work_id TEXT,
  verified_at TEXT,
  retry_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (fingerprint, media_kind, parser_version, rules_version),
  CHECK ((state = 'VERIFIED') = (profile_json IS NOT NULL AND work_id IS NOT NULL AND verified_at IS NOT NULL))
) STRICT;

CREATE INDEX public_discovery_pending_verification
  ON public_discovery_claims(state, updated_at, fingerprint)
  WHERE state = 'PENDING_VERIFICATION';

CREATE INDEX public_discovery_retry
  ON public_discovery_claims(state, retry_at)
  WHERE state != 'VERIFIED';

PRAGMA optimize;
