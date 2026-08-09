CREATE TABLE IF NOT EXISTS domain_favicon_cache (
  domain text PRIMARY KEY,
  mime_type text,
  data bytea,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  error text
);
CREATE INDEX IF NOT EXISTS domain_favicon_cache_fetched_idx ON domain_favicon_cache(fetched_at);
