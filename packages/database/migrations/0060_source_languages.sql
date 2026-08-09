ALTER TABLE user_catalog_preference ADD COLUMN IF NOT EXISTS preferred_languages text[] NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS site_metadata_cache (domain text PRIMARY KEY, language text, detection_method text NOT NULL, manifest_url text, raw_url text NOT NULL, detected_at timestamptz NOT NULL DEFAULT now(), error text);
CREATE INDEX IF NOT EXISTS site_metadata_cache_detected_idx ON site_metadata_cache(detected_at);
