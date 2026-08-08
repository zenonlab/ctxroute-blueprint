-- Canonical favorite parse artifact. Raw title/url remain in payload and in
-- progression provenance; this additive migration never rewrites user data.
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS parse_artifact jsonb;
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS parser_id text;
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS parser_version integer;
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS parser_fingerprint text;
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS parse_status text;

ALTER TABLE bookmark_import_item DROP CONSTRAINT IF EXISTS bookmark_import_item_parse_status_check;
ALTER TABLE bookmark_import_item ADD CONSTRAINT bookmark_import_item_parse_status_check
  CHECK (parse_status IS NULL OR parse_status IN ('parsed','identity-missing'));

CREATE INDEX IF NOT EXISTS bookmark_import_item_parser_reparse_idx
  ON bookmark_import_item(parser_id,parser_version,created_at)
  WHERE event <> 'removed';
