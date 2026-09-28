ALTER TABLE catalogue_canonical_titles_v1
  ADD COLUMN ambiguous INTEGER NOT NULL DEFAULT 0 CHECK (ambiguous IN (0, 1));
