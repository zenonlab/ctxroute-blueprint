-- Provider results are immutable, content-addressed profiles shared by every
-- pending review. A repeated parser result therefore occupies one row and all
-- users choose the exact same snapshot.
CREATE TABLE IF NOT EXISTS provider_profile (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_id text NOT NULL,
  payload_hash text NOT NULL,
  canonical_title text NOT NULL,
  associated_titles text[],
  type text,
  year int,
  start_date jsonb,
  status text,
  authors jsonb,
  categories text[],
  genres text[],
  image text,
  url text NOT NULL,
  payload jsonb NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, provider_id, payload_hash)
);
CREATE INDEX IF NOT EXISTS provider_profile_identity_idx ON provider_profile(provider,provider_id,last_seen_at DESC);

ALTER TABLE favorite_review_candidate ADD COLUMN IF NOT EXISTS profile_id uuid REFERENCES provider_profile(id) ON DELETE RESTRICT;

INSERT INTO provider_profile(provider,provider_id,payload_hash,canonical_title,associated_titles,type,year,start_date,status,authors,categories,genres,image,url,payload)
SELECT r.provider,c.provider_id,encode(digest(c.payload::text,'sha256'),'hex'),c.canonical_title,c.associated_titles,c.type,c.year,c.start_date,c.status,c.authors,c.categories,c.genres,c.image,c.url,c.payload
FROM favorite_review_candidate c JOIN favorite_review r ON r.id=c.review_id
ON CONFLICT(provider,provider_id,payload_hash) DO NOTHING;

UPDATE favorite_review_candidate c SET profile_id=p.id
FROM favorite_review r,provider_profile p
WHERE r.id=c.review_id AND p.provider=r.provider AND p.provider_id=c.provider_id
  AND p.payload_hash=encode(digest(c.payload::text,'sha256'),'hex') AND c.profile_id IS NULL;

-- Legacy columns remain readable during rolling deployment, but new rows only
-- store review-specific data plus the shared profile reference.
ALTER TABLE favorite_review_candidate ALTER COLUMN canonical_title DROP NOT NULL;
ALTER TABLE favorite_review_candidate ALTER COLUMN url DROP NOT NULL;
ALTER TABLE favorite_review_candidate ALTER COLUMN payload DROP NOT NULL;
CREATE INDEX IF NOT EXISTS favorite_review_candidate_profile_idx ON favorite_review_candidate(profile_id);
