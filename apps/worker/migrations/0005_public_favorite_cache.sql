CREATE TABLE favorite_public_cache (
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
  media_kind TEXT NOT NULL CHECK (media_kind IN ('ANIME', 'MANGA', 'MANHWA', 'MANHUA')),
  identity_hash TEXT NOT NULL CHECK (length(identity_hash) = 64),
  parser_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  references_json TEXT NOT NULL CHECK (json_valid(references_json)),
  metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  PRIMARY KEY (fingerprint, media_kind, parser_version, rules_version, identity_hash)
) STRICT;

CREATE INDEX favorite_public_cache_lookup
  ON favorite_public_cache(fingerprint, media_kind, parser_version, rules_version, identity_hash);

PRAGMA optimize;
