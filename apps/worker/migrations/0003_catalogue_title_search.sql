CREATE INDEX catalogue_titles_by_title
  ON catalogue_titles(title COLLATE NOCASE, work_id);

PRAGMA optimize;
