CREATE TABLE IF NOT EXISTS source_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE, canonical_url text NOT NULL,
  reason text NOT NULL CHECK(reason IN ('DEAD_LINK','WRONG_WORK','OTHER')), details text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,media_id,canonical_url)
);
CREATE INDEX IF NOT EXISTS source_report_media_idx ON source_report(media_id,created_at DESC);
