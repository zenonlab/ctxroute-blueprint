ALTER TABLE progression_observation ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS progress_parser_version integer;
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS progress_parser_fingerprint text;
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS progress_parse_status text
  CHECK (progress_parse_status IN ('evidence','no_evidence'));

CREATE TABLE IF NOT EXISTS favorite_progress_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  installation_id text NOT NULL,
  bookmark_id text NOT NULL,
  position_kind text NOT NULL CHECK (position_kind IN ('chapter','episode','volume')),
  position_number numeric NOT NULL CHECK (position_number >= 0),
  position_raw text NOT NULL,
  raw_title text NOT NULL,
  raw_url text NOT NULL,
  parsed_slug text,
  path_segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL,
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  last_observed_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  applied_media_id text REFERENCES media(id) ON DELETE SET NULL,
  UNIQUE(user_id, installation_id, bookmark_id, position_kind)
);
CREATE INDEX IF NOT EXISTS favorite_progress_candidate_pending_idx
  ON favorite_progress_candidate(user_id, installation_id, bookmark_id) WHERE applied_at IS NULL;

CREATE OR REPLACE FUNCTION favlib_materialize_progress_candidate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate favorite_progress_candidate%ROWTYPE;
DECLARE observation uuid;
BEGIN
  IF NEW.status NOT IN ('matched','accepted') OR NEW.media_id IS NULL THEN RETURN NEW; END IF;
  FOR candidate IN
    SELECT * FROM favorite_progress_candidate
    WHERE user_id=NEW.user_id AND installation_id=NEW.installation_id AND bookmark_id=NEW.bookmark_id
    ORDER BY position_number DESC, last_observed_at DESC
  LOOP
    IF EXISTS (
      SELECT 1 FROM favorite_progress current
      WHERE current.user_id=NEW.user_id AND current.media_id=NEW.media_id
        AND current.position_kind=candidate.position_kind
        AND current.position_number IS NOT NULL
        AND current.position_number >= candidate.position_number
    ) THEN CONTINUE; END IF;

    INSERT INTO progression_observation(user_id,media_id,source,position_kind,position_number,position_raw,provenance,confidence,consented,observed_at)
    VALUES(candidate.user_id,NEW.media_id,candidate.raw_url,candidate.position_kind,candidate.position_number,candidate.position_raw,
      candidate.evidence || jsonb_build_object('candidateId',candidate.id,'installationId',candidate.installation_id,'bookmarkId',candidate.bookmark_id,'rawTitle',candidate.raw_title,'rawUrl',candidate.raw_url,'pathSegments',candidate.path_segments),
      'high',true,candidate.last_observed_at)
    ON CONFLICT(user_id,media_id,source,position_kind,position_raw,observed_at)
    DO UPDATE SET provenance=progression_observation.provenance || excluded.provenance
    RETURNING id INTO observation;

    INSERT INTO favorite_progress(user_id,media_id,position_kind,position_number,position_raw,observation_id)
    VALUES(candidate.user_id,NEW.media_id,candidate.position_kind,candidate.position_number,candidate.position_raw,observation)
    ON CONFLICT(user_id,media_id,position_kind) DO UPDATE SET
      position_number=excluded.position_number, position_raw=excluded.position_raw,
      observation_id=excluded.observation_id, updated_at=now()
    WHERE favorite_progress.position_number IS NULL OR favorite_progress.position_number < excluded.position_number;

    UPDATE favorite_progress_candidate SET applied_at=now(),applied_media_id=NEW.media_id WHERE id=candidate.id;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookmark_media_link_materialize_progress ON bookmark_media_link;
CREATE TRIGGER bookmark_media_link_materialize_progress
AFTER INSERT OR UPDATE OF media_id,status ON bookmark_media_link
FOR EACH ROW EXECUTE FUNCTION favlib_materialize_progress_candidate();
