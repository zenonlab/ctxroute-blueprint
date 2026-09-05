CREATE TABLE catalogue_revisions (
  revision INTEGER PRIMARY KEY CHECK (revision > 0),
  published_at TEXT NOT NULL
) STRICT;

CREATE TABLE catalogue_works (
  work_id TEXT PRIMARY KEY,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('anime', 'manga')),
  preferred_title TEXT NOT NULL,
  revision INTEGER NOT NULL REFERENCES catalogue_revisions(revision)
) STRICT;

CREATE TABLE catalogue_titles (
  work_id TEXT NOT NULL REFERENCES catalogue_works(work_id) ON DELETE CASCADE,
  locale TEXT NOT NULL,
  title TEXT NOT NULL,
  PRIMARY KEY (work_id, locale, title)
) STRICT;

CREATE TABLE catalogue_external_references (
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  work_id TEXT NOT NULL REFERENCES catalogue_works(work_id) ON DELETE CASCADE,
  PRIMARY KEY (provider, external_id),
  UNIQUE (work_id, provider)
) STRICT;

CREATE INDEX catalogue_works_incremental
  ON catalogue_works(revision, work_id);

CREATE INDEX catalogue_references_by_work
  ON catalogue_external_references(work_id, provider, external_id);

PRAGMA optimize;
