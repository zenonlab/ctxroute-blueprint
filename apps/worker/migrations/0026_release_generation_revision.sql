CREATE TABLE catalogue_release_generation (
  id TEXT PRIMARY KEY CHECK (id = 'active'),
  revision TEXT NOT NULL CHECK (length(revision) = 32),
  observed_at TEXT NOT NULL
) STRICT;

INSERT INTO catalogue_release_generation (id, revision, observed_at)
SELECT 'active', lower(hex(randomblob(16))), COALESCE(MAX(observed_at), '1970-01-01T00:00:00.000Z')
FROM catalogue_release_model;

CREATE INDEX catalogue_release_model_provider_identity
  ON catalogue_release_model(provider, provider_work_id, valid_from, valid_to);

CREATE TRIGGER catalogue_release_generation_insert AFTER INSERT ON catalogue_release_model
BEGIN
  UPDATE catalogue_release_generation SET revision = lower(hex(randomblob(16))),
    observed_at = MAX(observed_at, NEW.observed_at) WHERE id = 'active';
END;

CREATE TRIGGER catalogue_release_generation_update AFTER UPDATE ON catalogue_release_model
BEGIN
  UPDATE catalogue_release_generation SET revision = lower(hex(randomblob(16))),
    observed_at = MAX(observed_at, NEW.observed_at) WHERE id = 'active';
END;

CREATE TRIGGER catalogue_release_generation_delete AFTER DELETE ON catalogue_release_model
BEGIN
  UPDATE catalogue_release_generation SET revision = lower(hex(randomblob(16))) WHERE id = 'active';
END;
