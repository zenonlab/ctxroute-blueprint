-- Pending provider candidates are durable review data. Keep their covers in
-- the shared image store as well, so later decisions do not depend on a
-- provider URL remaining reachable.
ALTER TABLE provider_profile
  ADD COLUMN IF NOT EXISTS cover_source_url text,
  ADD COLUMN IF NOT EXISTS cover_asset_sha256 text REFERENCES catalog_image_asset(sha256) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS cover_mime_type text,
  ADD COLUMN IF NOT EXISTS cover_width integer,
  ADD COLUMN IF NOT EXISTS cover_height integer,
  ADD COLUMN IF NOT EXISTS cover_byte_size integer,
  ADD COLUMN IF NOT EXISTS cover_status text NOT NULL DEFAULT 'PENDING' CHECK (cover_status IN ('PENDING','ACTIVE','FAILED')),
  ADD COLUMN IF NOT EXISTS cover_error text,
  ADD COLUMN IF NOT EXISTS cover_fetched_at timestamptz;

CREATE INDEX IF NOT EXISTS provider_profile_cover_idx
  ON provider_profile(cover_status)
  WHERE cover_status='ACTIVE';
