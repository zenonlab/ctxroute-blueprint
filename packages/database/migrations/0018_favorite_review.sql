-- Per-favorite ambiguity review. Candidate payloads are retained as audit
-- provenance; they do not become catalogue works until the user selects one.
CREATE TABLE IF NOT EXISTS favorite_review (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  installation_id text NOT NULL, bookmark_id text NOT NULL, favorite_title text NOT NULL, favorite_url text NOT NULL,
  provider text NOT NULL, status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RESOLVED','NO_MATCH')),
  selected_candidate_id uuid, decision jsonb, created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  UNIQUE(user_id, installation_id, bookmark_id, provider)
);
CREATE INDEX IF NOT EXISTS favorite_review_pending_idx ON favorite_review(user_id,status);
CREATE TABLE IF NOT EXISTS favorite_review_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), review_id uuid NOT NULL REFERENCES favorite_review(id) ON DELETE CASCADE,
  provider_id text NOT NULL, canonical_title text NOT NULL, hit_title text, associated_titles text[], type text, year int,
  start_date jsonb, status text, authors jsonb, categories text[], genres text[], image text, url text NOT NULL,
  payload jsonb NOT NULL, media_id text REFERENCES media(id) ON DELETE SET NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(review_id, provider_id)
);
ALTER TABLE favorite_review ADD CONSTRAINT favorite_review_selected_candidate_fk
  FOREIGN KEY (selected_candidate_id) REFERENCES favorite_review_candidate(id) ON DELETE SET NULL;
ALTER TABLE personal_notification DROP CONSTRAINT IF EXISTS personal_notification_user_id_release_key_kind_key;
CREATE UNIQUE INDEX IF NOT EXISTS personal_notification_review_unique ON personal_notification(user_id,release_key,kind);
