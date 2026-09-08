CREATE TABLE favorite_owners (
  owner_id TEXT PRIMARY KEY,
  revoke_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
) STRICT;
CREATE TABLE favorite_installations (
  owner_id TEXT NOT NULL REFERENCES favorite_owners(owner_id),
  installation_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, installation_id)
) STRICT;
CREATE TABLE favorite_pairings (
  owner_id TEXT NOT NULL REFERENCES favorite_owners(owner_id),
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_by TEXT,
  PRIMARY KEY (owner_id, token_hash)
) STRICT;
CREATE TABLE favorite_keys (
  key_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  media_kind TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  rules_version TEXT NOT NULL
) STRICT;
CREATE TABLE favorite_choices (
  owner_id TEXT NOT NULL REFERENCES favorite_owners(owner_id),
  key_id TEXT NOT NULL REFERENCES favorite_keys(key_id),
  identity_hash TEXT NOT NULL,
  media_kind TEXT NOT NULL,
  references_json TEXT NOT NULL CHECK (json_valid(references_json)),
  confirmed INTEGER NOT NULL CHECK (confirmed IN (0, 1)),
  PRIMARY KEY (owner_id, key_id)
) STRICT;
CREATE TABLE favorite_confirmations (
  key_id TEXT NOT NULL REFERENCES favorite_keys(key_id),
  identity_hash TEXT NOT NULL,
  media_kind TEXT NOT NULL,
  references_json TEXT NOT NULL CHECK (json_valid(references_json)),
  owner_count INTEGER NOT NULL CHECK (owner_count >= 0),
  PRIMARY KEY (key_id, identity_hash)
) STRICT;
CREATE INDEX favorite_confirmations_active ON favorite_confirmations(key_id, identity_hash, owner_count, media_kind, references_json) WHERE owner_count > 0;
CREATE TRIGGER favorite_choice_insert AFTER INSERT ON favorite_choices WHEN NEW.confirmed = 1 BEGIN
  INSERT INTO favorite_confirmations VALUES (NEW.key_id, NEW.identity_hash, NEW.media_kind, NEW.references_json, 1)
  ON CONFLICT(key_id, identity_hash) DO UPDATE SET owner_count = owner_count - (-1);
END;
CREATE TRIGGER favorite_choice_update AFTER UPDATE ON favorite_choices BEGIN
  UPDATE favorite_confirmations SET owner_count = owner_count - 1
  WHERE key_id = OLD.key_id AND identity_hash = OLD.identity_hash AND OLD.confirmed = 1;
  INSERT INTO favorite_confirmations SELECT NEW.key_id, NEW.identity_hash, NEW.media_kind, NEW.references_json, 1 WHERE NEW.confirmed = 1
  ON CONFLICT(key_id, identity_hash) DO UPDATE SET owner_count = owner_count - (-1);
END;
CREATE TABLE favorite_receipts (
  owner_id TEXT NOT NULL REFERENCES favorite_owners(owner_id),
  nonce TEXT NOT NULL,
  digest TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  response_json TEXT NOT NULL CHECK (json_valid(response_json)),
  PRIMARY KEY (owner_id, nonce)
) STRICT;
CREATE TABLE favorite_decisions (
  owner_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  choices_json TEXT NOT NULL CHECK (json_valid(choices_json)),
  PRIMARY KEY (owner_id, nonce),
  FOREIGN KEY (owner_id, nonce) REFERENCES favorite_receipts(owner_id, nonce)
) STRICT;
CREATE TABLE favorite_daily_quotas (
  owner_id TEXT NOT NULL REFERENCES favorite_owners(owner_id),
  day INTEGER NOT NULL,
  requests INTEGER NOT NULL CHECK (requests >= 0),
  PRIMARY KEY (owner_id, day)
) STRICT;
CREATE TABLE favorite_site_rules (
  revision INTEGER PRIMARY KEY,
  document_json TEXT NOT NULL CHECK (json_valid(document_json)),
  digest TEXT NOT NULL,
  published INTEGER NOT NULL CHECK (published IN (0, 1))
) STRICT;
CREATE INDEX favorite_site_rules_published ON favorite_site_rules(published, revision DESC);
