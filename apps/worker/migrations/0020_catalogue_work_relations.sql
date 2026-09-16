CREATE TABLE catalogue_work_relations (
  source_work_id TEXT NOT NULL REFERENCES catalogue_works(work_id),
  relation_type TEXT NOT NULL CHECK (relation_type IN ('ADAPTATION', 'RELATED')),
  target_provider TEXT NOT NULL,
  target_external_id TEXT NOT NULL,
  target_media_kind TEXT NOT NULL CHECK (target_media_kind IN ('ANIME', 'MANGA', 'MANHWA', 'MANHUA')),
  target_work_id TEXT REFERENCES catalogue_works(work_id),
  verified_at TEXT NOT NULL,
  PRIMARY KEY (source_work_id, relation_type, target_provider, target_external_id),
  CHECK (target_work_id IS NULL OR target_work_id <> source_work_id)
) STRICT;

CREATE INDEX catalogue_work_relations_target_reference
  ON catalogue_work_relations(target_provider, target_external_id);

CREATE INDEX catalogue_work_relations_target_work
  ON catalogue_work_relations(target_work_id)
  WHERE target_work_id IS NOT NULL;

PRAGMA optimize;
