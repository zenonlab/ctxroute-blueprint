-- Corrective migration for installations where 0036 was recorded before the
-- parser-state columns were introduced.
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS progress_parser_version integer;
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS progress_parser_fingerprint text;
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS progress_parse_status text;

ALTER TABLE bookmark_import_item DROP CONSTRAINT IF EXISTS bookmark_import_item_progress_parse_status_check;
ALTER TABLE bookmark_import_item ADD CONSTRAINT bookmark_import_item_progress_parse_status_check
  CHECK (progress_parse_status IN ('evidence','no_evidence'));
