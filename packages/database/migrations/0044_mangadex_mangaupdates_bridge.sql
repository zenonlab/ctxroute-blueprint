ALTER TABLE provider_request_waitlist DROP CONSTRAINT IF EXISTS provider_request_waitlist_provider_check;
ALTER TABLE provider_request_waitlist ADD CONSTRAINT provider_request_waitlist_provider_check
  CHECK(provider IN ('anilist','mangaupdates','mangadex'));

INSERT INTO provider_request_gate(provider,max_in_flight)
VALUES ('mangadex',1)
ON CONFLICT(provider) DO UPDATE SET max_in_flight=1;

CREATE OR REPLACE FUNCTION enforce_catalog_provider_policy()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider NOT IN ('anilist','mangaupdates','mangadex') THEN
    RAISE EXCEPTION 'CATALOG_PROVIDER_NOT_ALLOWED';
  END IF;
  RETURN NEW;
END $$;

INSERT INTO catalog_provider_policy(provider,status,version,license,attribution,purposes,fields,retention,purge_procedure,quota,terms_source,terms_checked_at,next_review_at)
VALUES ('mangadex','AUTHORIZED','resolution-v2','MangaDex API policy','MangaDex',ARRAY['identity-resolution','metadata-once','cover-once'],ARRAY['uuid','titles','descriptions','tags','status','year','language','demographic','content-rating','progress','authors','artists','relations','links.mu','cover_art'],'retained while an owning favorite exists; no automatic metadata refresh','removed with the owning media under normal retention','one concurrent request; conservative spacing and Retry-After','https://api.mangadex.org/docs/','2026-08-07','2027-08-07')
ON CONFLICT(provider) DO UPDATE SET version=excluded.version,purposes=excluded.purposes,fields=excluded.fields,attribution=excluded.attribution;

ALTER TABLE provider_payload DROP CONSTRAINT IF EXISTS provider_payload_provider_check;
ALTER TABLE provider_payload ADD CONSTRAINT provider_payload_provider_check CHECK(provider IN ('anilist','mangaupdates','mangadex'));

CREATE TABLE IF NOT EXISTS mangadex_promotion_state (
  media_id text PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  mangadex_id text NOT NULL,
  next_attempt_at timestamptz NOT NULL,
  last_attempt_at timestamptz,
  last_error text,
  matcher_version text NOT NULL,
  mangaupdates_id text,
  status text NOT NULL CHECK(status IN ('PENDING','PROMOTED')),
  promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mangadex_promotion_due_idx ON mangadex_promotion_state(status,next_attempt_at);

CREATE OR REPLACE FUNCTION favlib_next_paris_monday(value timestamptz) RETURNS timestamptz
LANGUAGE sql STABLE AS $$
  SELECT (((value AT TIME ZONE 'Europe/Paris')::date
    + CASE WHEN extract(isodow FROM value AT TIME ZONE 'Europe/Paris')::int = 1
           AND (value AT TIME ZONE 'Europe/Paris')::time < time '03:00' THEN 0
           ELSE 8 - extract(isodow FROM value AT TIME ZONE 'Europe/Paris')::int END)
    + time '03:00') AT TIME ZONE 'Europe/Paris'
$$;

UPDATE media_enrichment_state SET invalidated_at=now(),next_attempt_at=NULL,updated_at=now()
WHERE provider='mangaupdates' AND purpose='metadata' AND error_code IN ('NO_RESULT','LOW_CONFIDENCE');

-- Reviews have no mutable timestamp: enqueue reassessment without rewriting
-- personal review state or decisions.

SELECT graphile_worker.add_job('reassess-favorite-reviews','{}'::json,
  job_key := 'review-reassess:mangadex-bridge-v1',max_attempts := 3,job_key_mode := 'replace');
