CREATE TABLE collective_consents (
  consent_id TEXT PRIMARY KEY,
  write_token_hash TEXT NOT NULL,
  revoke_token_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
) STRICT;

CREATE TABLE collective_associations (
  consent_id TEXT NOT NULL REFERENCES collective_consents(consent_id),
  canonical_work_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_work_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  PRIMARY KEY (consent_id, nonce)
) STRICT;

CREATE INDEX collective_associations_quota
  ON collective_associations(consent_id, received_at);

CREATE INDEX collective_associations_lookup
  ON collective_associations(canonical_work_id, provider, external_work_id);

PRAGMA optimize;
