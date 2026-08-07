-- Shared provider facts. Personal progression remains in favorite_progress and is user scoped.
ALTER TABLE provider_progress
  ADD COLUMN IF NOT EXISTS available_position_kind text,
  ADD COLUMN IF NOT EXISTS available_position_number numeric,
  ADD COLUMN IF NOT EXISTS available_position_raw text,
  ADD COLUMN IF NOT EXISTS available_position_provenance jsonb;

ALTER TABLE provider_progress
  DROP CONSTRAINT IF EXISTS provider_progress_available_position_kind_check;
ALTER TABLE provider_progress
  ADD CONSTRAINT provider_progress_available_position_kind_check
  CHECK (available_position_kind IS NULL OR available_position_kind IN ('episode','chapter'));

UPDATE provider_progress
SET available_position_kind='chapter',
    available_position_number=latest_chapter::numeric,
    available_position_raw=latest_chapter,
    available_position_provenance=COALESCE(provenance,'{}'::jsonb)
WHERE available_position_kind IS NULL AND latest_chapter ~ '^[0-9]+(?:\.[0-9]+)?$';
