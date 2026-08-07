-- All current candidates are linked to a content-addressed provider profile
-- by migration 0021. Remove the rolling-deployment fallback once the shared
-- profile schema is the only read path.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM favorite_review_candidate WHERE profile_id IS NULL) THEN
    RAISE EXCEPTION 'Cannot drop legacy candidate payload columns: unlinked candidates remain';
  END IF;
END $$;
ALTER TABLE favorite_review_candidate
  DROP COLUMN IF EXISTS canonical_title,
  DROP COLUMN IF EXISTS associated_titles,
  DROP COLUMN IF EXISTS type,
  DROP COLUMN IF EXISTS year,
  DROP COLUMN IF EXISTS start_date,
  DROP COLUMN IF EXISTS status,
  DROP COLUMN IF EXISTS authors,
  DROP COLUMN IF EXISTS categories,
  DROP COLUMN IF EXISTS genres,
  DROP COLUMN IF EXISTS image,
  DROP COLUMN IF EXISTS url,
  DROP COLUMN IF EXISTS payload;
