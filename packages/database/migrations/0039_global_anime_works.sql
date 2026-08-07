-- Shared catalogue scope. Members retain independent media/provider identities;
-- only their card/progression projection is rooted. Exported with catalogue,
-- retained with AniList payload provenance, purged by media cascade, restored as catalogue data.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS anime_work_member (
  root_media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  media_id text NOT NULL UNIQUE REFERENCES media(id) ON DELETE CASCADE,
  anilist_id text NOT NULL UNIQUE,
  member_order integer NOT NULL CHECK (member_order >= 0),
  episode_total integer CHECK (episode_total IS NULL OR episode_total >= 0),
  cumulative_offset integer CHECK (cumulative_offset IS NULL OR cumulative_offset >= 0),
  status text NOT NULL CHECK (status IN ('PROVED','INCOMPLETE')),
  provenance jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(root_media_id,media_id),
  UNIQUE(root_media_id,member_order)
);

-- Personal scope. A chain review choice never mutates the shared catalogue graph.
CREATE TABLE IF NOT EXISTS user_anime_work_choice (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  seed_media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  selected_media_id text NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
  review_id uuid NOT NULL UNIQUE REFERENCES favorite_review(id) ON DELETE RESTRICT,
  provenance jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id,seed_media_id)
);

ALTER TABLE favorite_progress_candidate ADD COLUMN IF NOT EXISTS season integer, ADD COLUMN IF NOT EXISTS local_position_number numeric, ADD COLUMN IF NOT EXISTS global_position_number numeric;
ALTER TABLE progression_observation ADD COLUMN IF NOT EXISTS season integer, ADD COLUMN IF NOT EXISTS local_position_number numeric, ADD COLUMN IF NOT EXISTS global_position_number numeric;
ALTER TABLE progression_observation ADD COLUMN IF NOT EXISTS materialization_key text;
ALTER TABLE favorite_progress ADD COLUMN IF NOT EXISTS season integer, ADD COLUMN IF NOT EXISTS local_position_number numeric, ADD COLUMN IF NOT EXISTS global_position_number numeric;
ALTER TABLE provider_progress ADD COLUMN IF NOT EXISTS season integer, ADD COLUMN IF NOT EXISTS local_position_number numeric, ADD COLUMN IF NOT EXISTS global_position_number numeric;

CREATE OR REPLACE FUNCTION favlib_card_media_id(input_media_id text) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT root_media_id FROM anime_work_member WHERE media_id=input_media_id),input_media_id)
$$;

CREATE OR REPLACE FUNCTION favlib_anime_global_position(input_media_id text,local_number numeric DEFAULT NULL) RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT CASE WHEN cumulative_offset IS NULL THEN NULL ELSE cumulative_offset::numeric+COALESCE(local_number,0) END
  FROM anime_work_member WHERE media_id=input_media_id
$$;

CREATE INDEX IF NOT EXISTS anime_work_member_root_idx ON anime_work_member(root_media_id,member_order);
CREATE UNIQUE INDEX IF NOT EXISTS progression_observation_materialization_key_unique
  ON progression_observation(materialization_key) WHERE materialization_key IS NOT NULL;

ALTER TABLE favorite_review DROP CONSTRAINT IF EXISTS favorite_review_reason_check;
-- Review reasons are extensible provenance codes shared by both provider
-- resolvers. Do not reintroduce the legacy anime-only constraint here: an
-- existing database can already contain valid reasons emitted by either
-- resolver, and migration 0043 formalizes this contract.

-- Reinstall the shared candidate materializer so season/local/global evidence
-- follows the same trigger path as legacy candidates. Raw fields stay intact.
CREATE OR REPLACE FUNCTION favlib_materialize_progress_candidate() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE candidate favorite_progress_candidate%ROWTYPE;
DECLARE observation uuid;
BEGIN
  IF NEW.status NOT IN ('matched','accepted') OR NEW.media_id IS NULL THEN RETURN NEW; END IF;
  FOR candidate IN SELECT * FROM favorite_progress_candidate
    WHERE user_id=NEW.user_id AND installation_id=NEW.installation_id AND bookmark_id=NEW.bookmark_id
    ORDER BY position_number DESC,last_observed_at DESC
  LOOP
    IF EXISTS (SELECT 1 FROM favorite_progress current WHERE current.user_id=NEW.user_id AND current.media_id=NEW.media_id
      AND current.position_kind=candidate.position_kind AND current.position_number IS NOT NULL AND current.position_number>=candidate.position_number) THEN CONTINUE; END IF;
    INSERT INTO progression_observation(user_id,media_id,source,position_kind,position_number,position_raw,season,local_position_number,global_position_number,provenance,confidence,consented,observed_at)
    VALUES(candidate.user_id,NEW.media_id,candidate.raw_url,candidate.position_kind,candidate.position_number,candidate.position_raw,candidate.season,candidate.local_position_number,candidate.global_position_number,
      candidate.evidence||jsonb_build_object('candidateId',candidate.id,'installationId',candidate.installation_id,'bookmarkId',candidate.bookmark_id,'rawTitle',candidate.raw_title,'rawUrl',candidate.raw_url,'parsedSlug',candidate.parsed_slug,'pathSegments',candidate.path_segments),'high',true,candidate.last_observed_at)
    ON CONFLICT(user_id,media_id,source,position_kind,position_raw,observed_at) DO UPDATE SET provenance=progression_observation.provenance||excluded.provenance
    RETURNING id INTO observation;
    INSERT INTO favorite_progress(user_id,media_id,position_kind,position_number,position_raw,observation_id,season,local_position_number,global_position_number)
    VALUES(candidate.user_id,NEW.media_id,candidate.position_kind,candidate.position_number,candidate.position_raw,observation,candidate.season,candidate.local_position_number,candidate.global_position_number)
    ON CONFLICT(user_id,media_id,position_kind) DO UPDATE SET position_number=excluded.position_number,position_raw=excluded.position_raw,observation_id=excluded.observation_id,
      season=excluded.season,local_position_number=excluded.local_position_number,global_position_number=excluded.global_position_number,updated_at=now()
    WHERE favorite_progress.position_number IS NULL OR favorite_progress.position_number<excluded.position_number;
    UPDATE favorite_progress_candidate SET applied_at=now(),applied_media_id=NEW.media_id WHERE id=candidate.id;
  END LOOP;
  RETURN NEW;
END $$;
