
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS app_user (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, password_hash text NOT NULL, role text NOT NULL CHECK(role IN ('admin','member')), active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS user_session (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE, csrf_hash text NOT NULL, last_seen_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, absolute_expires_at timestamptz NOT NULL, revoked_at timestamptz);
CREATE INDEX IF NOT EXISTS user_session_user_idx ON user_session(user_id);
CREATE TABLE IF NOT EXISTS invitation (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL UNIQUE, email text NOT NULL, created_by uuid NOT NULL REFERENCES app_user(id), expires_at timestamptz NOT NULL, consumed_at timestamptz);
CREATE TABLE IF NOT EXISTS password_reset_token (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE, token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, consumed_at timestamptz);
CREATE TABLE IF NOT EXISTS security_event (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid, event text NOT NULL, target_id text, result text NOT NULL, request_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS deletion_tombstone (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text NOT NULL, entity_id text NOT NULL, deleted_at timestamptz NOT NULL DEFAULT now(), reason text NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency_key (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id uuid NOT NULL, route text NOT NULL, key text NOT NULL, body_hash text NOT NULL, response_code integer NOT NULL, response_body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(owner_id,route,key));

CREATE TABLE IF NOT EXISTS pairing_challenge (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), installation_id text NOT NULL, code_hash text NOT NULL, salt text NOT NULL, protocol integer NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz, activation_token text, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS pairing_challenge_installation_idx ON pairing_challenge(installation_id);
CREATE TABLE IF NOT EXISTS extension_device (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE, installation_id text NOT NULL, token_hash text NOT NULL UNIQUE, name text NOT NULL, browser text NOT NULL, protocol integer NOT NULL, last_sync_at timestamptz, verified_sync_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id, installation_id));
ALTER TABLE extension_device ADD COLUMN IF NOT EXISTS verified_sync_at timestamptz;
CREATE TABLE IF NOT EXISTS bookmark_import_batch (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), device_id uuid NOT NULL REFERENCES extension_device(id) ON DELETE CASCADE, batch_id uuid NOT NULL, cursor text, item_count integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(device_id,batch_id));
CREATE TABLE IF NOT EXISTS bookmark_import_item (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), batch_id uuid NOT NULL REFERENCES bookmark_import_batch(id) ON DELETE CASCADE, user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE, installation_id text NOT NULL, bookmark_id text NOT NULL, fingerprint text NOT NULL, event text NOT NULL CHECK(event IN ('created','changed','moved','removed')), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,installation_id,fingerprint));
CREATE TABLE IF NOT EXISTS reconciliation_cursor (device_id uuid PRIMARY KEY REFERENCES extension_device(id) ON DELETE CASCADE, cursor text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS bookmark_import_item_user_idx ON bookmark_import_item(user_id,created_at);

CREATE TABLE IF NOT EXISTS approved_site (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE, device_id uuid REFERENCES extension_device(id) ON DELETE CASCADE, domain text NOT NULL, source text NOT NULL CHECK(source IN ('bookmark','manual')), created_at timestamptz NOT NULL DEFAULT now());
DROP INDEX IF EXISTS approved_site_scope_unique;
CREATE UNIQUE INDEX IF NOT EXISTS approved_site_device_unique ON approved_site(user_id,device_id,domain) WHERE device_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS approved_site_user_unique ON approved_site(user_id,domain) WHERE device_id IS NULL;
CREATE TABLE IF NOT EXISTS url_check (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE, url text NOT NULL, status text NOT NULL CHECK(status IN ('accessible','needs_review','offline','unknown')), checked_at timestamptz, error text, failures integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS url_check_user_url_unique ON url_check(user_id,url);
CREATE TABLE IF NOT EXISTS favorite_update_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE, device_id uuid REFERENCES extension_device(id) ON DELETE SET NULL, bookmark_id text NOT NULL, old_url text NOT NULL, old_title text NOT NULL, new_url text NOT NULL, new_title text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), undone_at timestamptz);

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE TABLE IF NOT EXISTS media (id text PRIMARY KEY, type text NOT NULL CHECK(type IN ('ANIME','MANGA','MANHWA','MANHUA','UNKNOWN')), season_year integer, country_of_origin text, format text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS media_title (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE, text text NOT NULL, normalized_text text NOT NULL, language text, kind text NOT NULL, connector text, provenance jsonb NOT NULL, UNIQUE(media_id,normalized_text,language,kind,connector));
CREATE INDEX IF NOT EXISTS media_title_exact_idx ON media_title(normalized_text);
CREATE INDEX IF NOT EXISTS media_title_trgm_idx ON media_title USING gin(normalized_text gin_trgm_ops);
CREATE TABLE IF NOT EXISTS media_external_id (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE, provider text NOT NULL, external_id text NOT NULL, provenance jsonb NOT NULL, UNIQUE(provider,external_id));
CREATE TABLE IF NOT EXISTS media_relation (media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE, target_media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE, kind text NOT NULL, provenance jsonb NOT NULL, PRIMARY KEY(media_id,target_media_id,kind));
CREATE TABLE IF NOT EXISTS classification_run (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE, classifier_version text NOT NULL, input_fingerprint text NOT NULL, status text NOT NULL CHECK(status IN ('matched','review','ignored')), matches jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,input_fingerprint,classifier_version));
CREATE TABLE IF NOT EXISTS bookmark_media_link (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE, installation_id text NOT NULL, bookmark_id text NOT NULL, media_id text REFERENCES media(id) ON DELETE SET NULL, status text NOT NULL CHECK(status IN ('matched','review','ignored')), classifier_version text NOT NULL, evidence jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,installation_id,bookmark_id,classifier_version));
CREATE TABLE IF NOT EXISTS catalog_provider_policy (provider text PRIMARY KEY, status text NOT NULL CHECK(status IN ('AUTHORIZED','REVIEW_REQUIRED','DISABLED')), version text NOT NULL, license text, attribution text, reviewed_at timestamptz NOT NULL DEFAULT now(), purge_after timestamptz);
CREATE TABLE IF NOT EXISTS dataset_release (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), provider text NOT NULL, release text NOT NULL, published_at timestamptz NOT NULL, policy_status text NOT NULL, license text NOT NULL, manifest jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider,release));
CREATE TABLE IF NOT EXISTS dataset_import_run (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), release_id uuid NOT NULL REFERENCES dataset_release(id) ON DELETE RESTRICT, status text NOT NULL CHECK(status IN ('STAGED','ACTIVE','ROLLED_BACK','REJECTED')), checkpoint text, mapper_version text NOT NULL, accepted_count integer NOT NULL DEFAULT 0, rejected_count integer NOT NULL DEFAULT 0, error text, started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz);
CREATE TABLE IF NOT EXISTS dataset_record_staging (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), release_id uuid NOT NULL REFERENCES dataset_release(id) ON DELETE CASCADE, provider_record_id text NOT NULL, payload jsonb NOT NULL, record_hash text NOT NULL, status text NOT NULL CHECK(status IN ('STAGED','ACCEPTED','REJECTED')), error text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(release_id,provider_record_id));

CREATE TABLE IF NOT EXISTS source_snapshot (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES app_user(id) ON DELETE CASCADE, scope_key text NOT NULL, connector text NOT NULL, connector_version text NOT NULL, canonical_target text NOT NULL, locale text NOT NULL DEFAULT '', region text NOT NULL DEFAULT '', status text NOT NULL CHECK(status IN ('VALID','QUARANTINED','NOT_MODIFIED','ERROR')), fetched_at timestamptz NOT NULL, payload jsonb NOT NULL, payload_hash text NOT NULL, error text, UNIQUE(scope_key,connector,connector_version,canonical_target,locale,region));
CREATE TABLE IF NOT EXISTS release_announcement (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE, release_key text NOT NULL, provider text NOT NULL, status text NOT NULL CHECK(status IN ('SCHEDULED','ANNOUNCED')), announced_at timestamptz NOT NULL, provenance jsonb NOT NULL, UNIQUE(provider,release_key));
CREATE TABLE IF NOT EXISTS release_origin (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES app_user(id) ON DELETE CASCADE, scope_key text NOT NULL, media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE, release_key text NOT NULL, connector text NOT NULL, canonical_url text NOT NULL, status text NOT NULL CHECK(status IN ('AVAILABLE','STALE','ERROR')), checked_at timestamptz NOT NULL, provenance jsonb NOT NULL, UNIQUE(scope_key,release_key,connector,canonical_url));
CREATE TABLE IF NOT EXISTS domain_favicon_cache (domain text PRIMARY KEY, mime_type text, data bytea, fetched_at timestamptz NOT NULL DEFAULT now(), error text);
ALTER TABLE user_catalog_preference ADD COLUMN IF NOT EXISTS preferred_languages text[] NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS site_metadata_cache (domain text PRIMARY KEY, language text, detection_method text NOT NULL, manifest_url text, raw_url text NOT NULL, detected_at timestamptz NOT NULL DEFAULT now(), error text);
CREATE TABLE IF NOT EXISTS source_check_lease (scope_key text PRIMARY KEY, owner text NOT NULL, expires_at timestamptz NOT NULL, acquired_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS personal_notification (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE, release_key text NOT NULL, kind text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), read_at timestamptz, UNIQUE(user_id,release_key,kind));

CREATE TABLE IF NOT EXISTS progression_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  source text NOT NULL,
  position_kind text NOT NULL,
  position_number numeric,
  position_raw text NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence text NOT NULL,
  consented boolean NOT NULL DEFAULT false,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, media_id, source, position_kind, position_raw, observed_at)
);
CREATE TABLE IF NOT EXISTS favorite_progress (
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  position_kind text NOT NULL,
  position_number numeric,
  position_raw text NOT NULL,
  observation_id uuid NOT NULL REFERENCES progression_observation(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, media_id, position_kind)
);
CREATE TABLE IF NOT EXISTS favorite_progress_candidate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  installation_id text NOT NULL, bookmark_id text NOT NULL,
  position_kind text NOT NULL CHECK(position_kind IN ('chapter','episode','volume')),
  position_number numeric NOT NULL CHECK(position_number>=0), position_raw text NOT NULL,
  raw_title text NOT NULL, raw_url text NOT NULL, parsed_slug text, path_segments jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence jsonb NOT NULL, first_observed_at timestamptz NOT NULL DEFAULT now(), last_observed_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz, applied_media_id text REFERENCES media(id) ON DELETE SET NULL,
  UNIQUE(user_id,installation_id,bookmark_id,position_kind)
);
CREATE INDEX IF NOT EXISTS favorite_progress_candidate_pending_idx ON favorite_progress_candidate(user_id,installation_id,bookmark_id) WHERE applied_at IS NULL;
DO $$ BEGIN
  IF to_regprocedure('favlib_materialize_progress_candidate()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS bookmark_media_link_materialize_progress ON bookmark_media_link;
    CREATE TRIGGER bookmark_media_link_materialize_progress AFTER INSERT OR UPDATE OF media_id,status ON bookmark_media_link FOR EACH ROW EXECUTE FUNCTION favlib_materialize_progress_candidate();
  END IF;
END $$;
CREATE OR REPLACE FUNCTION favlib_progression_provenance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.provenance := COALESCE(NEW.provenance, '{}'::jsonb) || jsonb_build_object('sourceUrl', NEW.source, 'positionRaw', NEW.position_raw, 'positionKind', NEW.position_kind); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS progression_observation_provenance ON progression_observation;
CREATE TRIGGER progression_observation_provenance BEFORE INSERT OR UPDATE ON progression_observation FOR EACH ROW EXECUTE FUNCTION favlib_progression_provenance();

-- Anime work tables and global-position columns are installed by ordered
-- migrations 0036-0039 after all referenced legacy tables exist.

CREATE TABLE IF NOT EXISTS source_connector (
  id text PRIMARY KEY,
  domain text NOT NULL,
  state text NOT NULL CHECK(state IN ('DISABLED','REVIEW','ACTIVE','ERROR')),
  feature_flag text NOT NULL,
  active_version text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS source_connector_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id text NOT NULL REFERENCES source_connector(id) ON DELETE CASCADE,
  version text NOT NULL,
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_id,version)
);

CREATE TABLE IF NOT EXISTS account_export (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  status text NOT NULL CHECK(status IN ('READY','PURGED')),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  purge_after timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE TABLE IF NOT EXISTS notification_preference (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  digest_enabled boolean NOT NULL DEFAULT false,
  preferred_origin_alert boolean NOT NULL DEFAULT false,
  ntfy_topic text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_export_purge_idx ON account_export(purge_after) WHERE status='READY';
ALTER TABLE personal_notification ADD COLUMN IF NOT EXISTS delivered_at timestamptz;
CREATE TABLE IF NOT EXISTS account_deletion_request (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours',
  completed_at timestamptz
);

-- Public snapshot collection is shared; release origins and notifications remain user-scoped.
ALTER TABLE release_origin DROP CONSTRAINT IF EXISTS release_origin_scope_key_release_key_connector_canonical_url_key;
ALTER TABLE release_origin DROP CONSTRAINT IF EXISTS release_origin_scope_key_release_key_connector_canonical_ur_key;
CREATE UNIQUE INDEX IF NOT EXISTS release_origin_user_scope_unique ON release_origin(user_id,scope_key,release_key,connector,canonical_url);

ALTER TABLE bookmark_media_link DROP CONSTRAINT IF EXISTS bookmark_media_link_status_check;
ALTER TABLE bookmark_media_link ADD CONSTRAINT bookmark_media_link_status_check CHECK(status IN ('matched','review','ignored','accepted','removed'));

CREATE TABLE IF NOT EXISTS media_metadata (media_id text PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE, provider text NOT NULL, external_id text, source_url text, latest_chapter text, status text NOT NULL DEFAULT 'FALLBACK' CHECK(status IN ('ACTIVE','FAILED','STALE','FALLBACK')), resolved_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(provider,external_id));
CREATE TABLE IF NOT EXISTS media_cover (media_id text PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE, source_url text, provider text NOT NULL DEFAULT 'unknown', attribution text, mime_type text NOT NULL, data text, asset_sha256 text, content_sha256 text, width integer, height integer, byte_size integer NOT NULL, status text NOT NULL CHECK(status IN ('ACTIVE','FAILED','STALE','FALLBACK')), fetched_at timestamptz NOT NULL DEFAULT now(), error text);
ALTER TABLE media_cover ADD COLUMN IF NOT EXISTS provider_external_id text;
ALTER TABLE media_cover ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE TABLE IF NOT EXISTS metadata_assertion(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,field text NOT NULL,value jsonb NOT NULL,provider text NOT NULL,source_url text NOT NULL,confidence numeric(4,3) NOT NULL,asserted_at timestamptz NOT NULL DEFAULT now(),attribution text,UNIQUE(media_id,field,provider,source_url));
CREATE INDEX IF NOT EXISTS metadata_assertion_media_field_idx ON metadata_assertion(media_id,field,asserted_at DESC);
CREATE TABLE IF NOT EXISTS metadata_attempt (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES app_user(id) ON DELETE CASCADE, media_id text REFERENCES media(id) ON DELETE CASCADE, input_url text NOT NULL, provider text NOT NULL, status text NOT NULL, error text, attempts integer NOT NULL DEFAULT 1, next_retry_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS metadata_attempt_retry_idx ON metadata_attempt(status,next_retry_at);

ALTER TABLE pairing_challenge ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS pairing_challenge_expiry_idx ON pairing_challenge(expires_at, consumed_at, attempts);

ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS classification_status text NOT NULL DEFAULT 'review';
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS classification_reason text;
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS parse_artifact jsonb;
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS parser_id text;
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS parser_version integer;
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS parser_fingerprint text;
ALTER TABLE bookmark_import_item ADD COLUMN IF NOT EXISTS parse_status text;

DO $$ BEGIN
  ALTER TABLE bookmark_import_item ADD CONSTRAINT bookmark_import_item_classification_status_check CHECK (classification_status IN ('recognized','review','excluded'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- Final readable-title policy. Keep this after every older bootstrap version.
CREATE OR REPLACE FUNCTION favlib_display_title(target_media_id text, target_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE selected media_title%ROWTYPE; reference_title text; shown text;
BEGIN
  SELECT favlib_clean_display_title(t.text) INTO reference_title FROM media_title t
  WHERE t.media_id=target_media_id AND t.kind='source'
  ORDER BY t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;
  SELECT t.* INTO selected FROM media_title t
  WHERE t.media_id=target_media_id AND t.kind<>'personal'
    AND t.connector IN ('anilist','mangaupdates')
    AND favlib_clean_display_title(t.text) IS NOT NULL
    AND ((t.kind='translation' AND t.language='en') OR t.title_type='romaji' OR t.script='Latn' OR t.text ~ '[A-Za-zÀ-ÖØ-öø-ÿ]')
  ORDER BY (t.kind='translation' AND t.language='en') DESC,
    (t.title_type='romaji') DESC,(t.script='Latn') DESC,
    (t.title_type='canonical') DESC,t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;
  IF selected.id IS NOT NULL THEN
    shown:=favlib_clean_display_title(selected.text);
    RETURN jsonb_build_object('title',shown,'referenceTitle',reference_title,'score',1,
      'alias',jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,'connector',selected.connector),
      'reason',CASE WHEN selected.kind='translation' AND selected.language='en' THEN 'ENGLISH_FALLBACK' WHEN selected.title_type='romaji' THEN 'ROMAJI_FALLBACK' WHEN selected.title_type='canonical' THEN 'PROVIDER_CANONICAL' ELSE 'PROVIDER_LATIN_FALLBACK' END);
  END IF;
  RETURN jsonb_build_object('title',NULL,'referenceTitle',reference_title,'score',0,'alias',NULL,'reason','NO_LATIN_TITLE');
END $$;

-- Final provider-only reset policy. Personal state and local image assets are
-- intentionally outside the reset boundary.
CREATE OR REPLACE FUNCTION favlib_reset_catalog(confirmation text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE removed_titles integer := 0; removed_assertions integer := 0;
BEGIN
  IF confirmation IS DISTINCT FROM 'RESET-FAVLIB-CATALOG' THEN RAISE EXCEPTION 'RESET_CONFIRMATION_REQUIRED'; END IF;
  DELETE FROM media_title WHERE connector IN ('anilist','mangaupdates'); GET DIAGNOSTICS removed_titles = ROW_COUNT;
  DELETE FROM metadata_assertion WHERE provider IN ('anilist','mangaupdates'); GET DIAGNOSTICS removed_assertions = ROW_COUNT;
  DELETE FROM provider_payload WHERE provider IN ('anilist','mangaupdates'); DELETE FROM provider_sync_state WHERE provider IN ('anilist','mangaupdates'); DELETE FROM media_enrichment_state WHERE provider IN ('anilist','mangaupdates'); DELETE FROM media_metadata WHERE provider IN ('anilist','mangaupdates'); DELETE FROM provider_progress WHERE provider IN ('anilist','mangaupdates'); DELETE FROM media_external_id WHERE provider IN ('anilist','mangaupdates'); DELETE FROM media_airing WHERE provider IN ('anilist','mangaupdates'); DELETE FROM release_announcement WHERE provider IN ('anilist','mangaupdates');
  RETURN jsonb_build_object('removedMedia',0,'removedProviderTitles',removed_titles,'removedProviderAssertions',removed_assertions,'preservedFavoriteMedia',(SELECT count(DISTINCT media_id) FROM bookmark_media_link WHERE media_id IS NOT NULL AND status IN ('matched','accepted')),'preservedCovers',(SELECT count(*) FROM media_cover WHERE status='ACTIVE'),'preservedImageAssets',(SELECT count(*) FROM catalog_image_asset),'enqueued',0);
END $$;

-- Final provider-only reset policy. Personal state and local image assets are
-- intentionally outside the reset boundary.
CREATE OR REPLACE FUNCTION favlib_reset_catalog(confirmation text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE removed_titles integer := 0; removed_assertions integer := 0;
BEGIN
  IF confirmation IS DISTINCT FROM 'RESET-FAVLIB-CATALOG' THEN RAISE EXCEPTION 'RESET_CONFIRMATION_REQUIRED'; END IF;
  DELETE FROM media_title WHERE connector IN ('anilist','mangaupdates'); GET DIAGNOSTICS removed_titles = ROW_COUNT;
  DELETE FROM metadata_assertion WHERE provider IN ('anilist','mangaupdates'); GET DIAGNOSTICS removed_assertions = ROW_COUNT;
  DELETE FROM provider_payload WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM provider_sync_state WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_enrichment_state WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_metadata WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM provider_progress WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_external_id WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_airing WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM release_announcement WHERE provider IN ('anilist','mangaupdates');
  RETURN jsonb_build_object('removedMedia',0,'removedProviderTitles',removed_titles,'removedProviderAssertions',removed_assertions,'preservedFavoriteMedia',(SELECT count(DISTINCT media_id) FROM bookmark_media_link WHERE media_id IS NOT NULL AND status IN ('matched','accepted')),'preservedCovers',(SELECT count(*) FROM media_cover WHERE status='ACTIVE'),'preservedImageAssets',(SELECT count(*) FROM catalog_image_asset),'enqueued',0);
END $$;

UPDATE bookmark_import_item item SET classification_status=CASE
  WHEN item.event='removed' THEN 'excluded'
  WHEN EXISTS (SELECT 1 FROM bookmark_media_link link WHERE link.user_id=item.user_id AND link.installation_id=item.installation_id AND link.bookmark_id=item.bookmark_id AND link.status IN ('matched','accepted')) THEN 'recognized'
  ELSE 'review'
END,
classification_reason=CASE
  WHEN item.event='removed' THEN 'REMOVED'
  WHEN EXISTS (SELECT 1 FROM bookmark_media_link link WHERE link.user_id=item.user_id AND link.installation_id=item.installation_id AND link.bookmark_id=item.bookmark_id AND link.status IN ('matched','accepted')) THEN 'HISTORICAL_LINK'
  ELSE 'HISTORICAL_UNRESOLVED'
END
WHERE item.classification_reason IS NULL;

DELETE FROM bookmark_import_item older USING bookmark_import_item newer
WHERE older.user_id=newer.user_id AND older.installation_id=newer.installation_id AND older.bookmark_id=newer.bookmark_id
  AND (older.created_at<newer.created_at OR (older.created_at=newer.created_at AND older.id<newer.id));

ALTER TABLE bookmark_import_item DROP CONSTRAINT IF EXISTS bookmark_import_item_user_id_installation_id_fingerprint_key;
DROP INDEX IF EXISTS bookmark_import_user_installation_fingerprint_unique;
CREATE UNIQUE INDEX IF NOT EXISTS bookmark_import_user_installation_bookmark_unique ON bookmark_import_item(user_id,installation_id,bookmark_id);
CREATE INDEX IF NOT EXISTS bookmark_import_item_classification_idx ON bookmark_import_item(user_id,installation_id,classification_status);

-- Remove resolver markers from the canonical catalogue.
UPDATE media SET format=NULL WHERE lower(format) IN ('source-resolved','shounen','shoujo','josei','seinen','none');

-- Global operational state only: one overwritten row per local service, no personal data/export.
-- A restored stale timestamp remains stale until the corresponding service runs again.
CREATE TABLE IF NOT EXISTS service_heartbeat (
  service text PRIMARY KEY,
  observed_at timestamptz NOT NULL,
  build_version text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE service_heartbeat ADD COLUMN IF NOT EXISTS build_version text;
ALTER TABLE service_heartbeat ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Stabilisation V1: état global administrable, sans donnée personnelle dans les valeurs.
CREATE TABLE IF NOT EXISTS operational_setting (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_event_created_idx ON admin_audit_event(created_at DESC);

ALTER TABLE invitation ADD COLUMN IF NOT EXISTS revoked_at timestamptz;
ALTER TABLE invitation ADD COLUMN IF NOT EXISTS revoked_by uuid REFERENCES app_user(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS backup_run (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK(status IN ('REQUESTED','CREATING','READY','FAILED')),
  manifest_name text,
  checksum text,
  byte_size bigint,
  requested_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  verified_at timestamptz,
  restore_tested_at timestamptz,
  rpo_seconds bigint,
  rto_seconds bigint,
  error_code text
);

CREATE TABLE IF NOT EXISTS domain_proposal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL,
  state text NOT NULL DEFAULT 'PROPOSED' CHECK(state IN ('PROPOSED','APPROVED','REJECTED')),
  proposed_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  reviewed_by uuid REFERENCES app_user(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE(domain)
);

-- Remove remaining resolver markers and technical identifiers masquerading as titles.
UPDATE media SET format=NULL WHERE lower(format) IN ('source-pending','source-resolved','untitled');
DELETE FROM media_title WHERE lower(trim(text)) IN ('untitled','source-pending','source-resolved') OR text=media_id;

-- Enrichment is canonical/public state. It is shared by users only after they
-- have been linked to the same media identity. Historical metadata_attempt rows
-- remain immutable evidence and are intentionally not migrated into this state.
CREATE TABLE IF NOT EXISTS media_enrichment_state (
  media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  provider text NOT NULL,
  purpose text NOT NULL,
  connector_version text NOT NULL,
  input_fingerprint text NOT NULL CHECK(input_fingerprint ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK(status IN ('PENDING','SUCCESS','NO_MATCH','FAILED','TERMINAL')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
  next_attempt_at timestamptz,
  error_code text,
  external_id text,
  locked_at timestamptz,
  locked_by text,
  invalidated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(media_id,provider,purpose,connector_version)
);
CREATE INDEX IF NOT EXISTS media_enrichment_due_idx
  ON media_enrichment_state(status,next_attempt_at)
  WHERE status IN ('PENDING','NO_MATCH','FAILED');

CREATE TABLE IF NOT EXISTS media_identity_merge (
  source_media_id text PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  target_media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_id text NOT NULL,
  evidence jsonb NOT NULL,
  merged_at timestamptz NOT NULL DEFAULT now(),
  CHECK(source_media_id<>target_media_id)
);

-- A strong provider-id collision is an explicit, auditable canonical merge. The
-- source row remains as a historical alias; identifiers are never silently stolen.
CREATE OR REPLACE FUNCTION merge_media_identity(source_id text,target_id text,merge_provider text,merge_external_id text,merge_evidence jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF source_id=target_id THEN RETURN; END IF;
  INSERT INTO media_identity_merge(source_media_id,target_media_id,provider,external_id,evidence)
  VALUES(source_id,target_id,merge_provider,merge_external_id,merge_evidence)
  ON CONFLICT(source_media_id) DO UPDATE SET target_media_id=excluded.target_media_id,provider=excluded.provider,external_id=excluded.external_id,evidence=excluded.evidence,merged_at=now();
  DELETE FROM media_relation
  WHERE media_id=source_id AND kind='canonical_variant' AND target_media_id<>target_id;
  INSERT INTO media_relation(media_id,target_media_id,kind,provenance)
  VALUES(source_id,target_id,'canonical_variant',merge_evidence)
  ON CONFLICT(media_id,target_media_id,kind) DO UPDATE SET provenance=excluded.provenance;
  INSERT INTO media_title(media_id,text,normalized_text,language,kind,connector,provenance)
    SELECT target_id,text,normalized_text,language,kind,connector,provenance FROM media_title WHERE media_id=source_id ON CONFLICT DO NOTHING;
  INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence,asserted_at,attribution)
    SELECT target_id,field,value,provider,source_url,confidence,asserted_at,attribution FROM metadata_assertion WHERE media_id=source_id ON CONFLICT DO NOTHING;
  UPDATE media_external_id SET media_id=target_id WHERE media_id=source_id;
  INSERT INTO media_cover(media_id,source_url,provider,attribution,mime_type,data,width,height,byte_size,status,fetched_at,error)
    SELECT target_id,source_url,provider,attribution,mime_type,data,width,height,byte_size,status,fetched_at,error FROM media_cover WHERE media_id=source_id ON CONFLICT(media_id) DO NOTHING;
  UPDATE bookmark_media_link SET media_id=target_id WHERE media_id=source_id;
  DELETE FROM favorite_progress s USING favorite_progress t WHERE s.media_id=source_id AND t.media_id=target_id AND s.user_id=t.user_id AND s.position_kind=t.position_kind;
  UPDATE favorite_progress SET media_id=target_id WHERE media_id=source_id;
  UPDATE release_announcement SET media_id=target_id WHERE media_id=source_id;
  UPDATE release_origin SET media_id=target_id WHERE media_id=source_id;
END $$;

-- Shared operational protection only; no private URL or page content is kept.
CREATE TABLE IF NOT EXISTS provider_domain_circuit (
  domain text PRIMARY KEY,
  status text NOT NULL DEFAULT 'CLOSED' CHECK(status IN ('CLOSED','OPEN')),
  failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count >= 0),
  blocked_until timestamptz,
  error_code text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- A receipt makes extension observations idempotent without retaining HTML.
CREATE TABLE IF NOT EXISTS extension_metadata_receipt (
  device_id uuid NOT NULL REFERENCES extension_device(id) ON DELETE CASCADE,
  media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  page_key text NOT NULL,
  input_fingerprint text NOT NULL CHECK(input_fingerprint ~ '^[0-9a-f]{64}$'),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(device_id,media_id,page_key)
);

CREATE TABLE IF NOT EXISTS extension_preference (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  auto_update_favorites boolean NOT NULL DEFAULT false,
  observe_navigation boolean NOT NULL DEFAULT false,
  sync_minutes integer NOT NULL DEFAULT 15 CHECK(sync_minutes BETWEEN 5 AND 1440),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS favorite_update_proposal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  device_id uuid REFERENCES extension_device(id) ON DELETE SET NULL,
  bookmark_id text NOT NULL,
  expected_url text NOT NULL,
  expected_title text NOT NULL,
  new_url text NOT NULL,
  new_title text NOT NULL,
  domain text NOT NULL,
  state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','APPLIED','CANCELLED','STALE','FAILED')),
  result_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE(user_id,bookmark_id,new_url,new_title)
);
CREATE INDEX IF NOT EXISTS favorite_update_proposal_pending_idx
  ON favorite_update_proposal(user_id,device_id,created_at)
  WHERE state='PENDING';

CREATE TABLE IF NOT EXISTS extension_release (
  browser text PRIMARY KEY CHECK(browser IN ('chrome','firefox')),
  version text NOT NULL,
  protocol integer NOT NULL,
  checksum_sha256 text NOT NULL CHECK(checksum_sha256 ~ '^[0-9a-f]{64}$'),
  artifact_url text NOT NULL,
  update_manifest_url text,
  installation_mode text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE media_enrichment_state IS 'Owner: canonical catalog; purpose: provider idempotence; export: admin aggregate only; retention/purge: cascade with media; restore: static SUCCESS remains valid until invalidated.';
COMMENT ON TABLE media_identity_merge IS 'Owner: canonical catalog; purpose: auditable strong-identity merges; export: catalog provenance; retention/purge: cascade with media; restore: preserves canonical redirects.';
COMMENT ON TABLE provider_domain_circuit IS 'Owner: instance operations; purpose: shared domain backoff; export: no; retention: reset after recovery; restore: expired blocks are harmless.';
COMMENT ON TABLE extension_metadata_receipt IS 'Owner: extension user via device; purpose: metadata idempotence; export: fingerprint only; retention/purge: cascade with device/media; restore: prevents duplicate enqueue.';
COMMENT ON TABLE extension_preference IS 'Owner: user; purpose: authoritative extension preferences; export: account export; retention/purge: cascade with user; restore: restored preference remains opt-in state.';
COMMENT ON TABLE favorite_update_proposal IS 'Owner: user; purpose: extension update coordination/history; export: account export; retention/purge: cascade with user; restore: extension rechecks bookmark before applying.';
COMMENT ON TABLE extension_release IS 'Owner: instance; purpose: public extension distribution metadata; export: public; retention: current release only; restore: publication verification must be rerun.';

-- Frozen ntfy batches. Notifications remain the complete personal inbox.
CREATE TABLE IF NOT EXISTS notification_delivery_batch (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  topic text NOT NULL,
  event_ids uuid[] NOT NULL CHECK(cardinality(event_ids) BETWEEN 1 AND 100),
  sequence_id text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SENDING','DELIVERED','FAILED')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 10),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  leased_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);
ALTER TABLE personal_notification ADD COLUMN IF NOT EXISTS delivery_batch_id uuid REFERENCES notification_delivery_batch(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS notification_delivery_batch_due_idx ON notification_delivery_batch(next_attempt_at) WHERE status IN ('PENDING','SENDING');
CREATE INDEX IF NOT EXISTS personal_notification_delivery_pending_idx ON personal_notification(user_id,created_at) WHERE delivered_at IS NULL;
COMMENT ON TABLE notification_delivery_batch IS 'Owner: user_id; purpose: frozen external push delivery; export: delivery diagnostics; retention: purge 30 days after delivery; restore: retry only undelivered frozen IDs.';

CREATE TABLE IF NOT EXISTS security_rate_limit (
  bucket text NOT NULL, subject_hash text NOT NULL, window_started_at timestamptz NOT NULL DEFAULT now(),
  attempt_count integer NOT NULL DEFAULT 0, blocked_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(bucket,subject_hash)
);
COMMENT ON TABLE security_rate_limit IS 'Owner: instance security; purpose: anti-bruteforce counters; export: no; retention: purge after 24 hours; restore: expired blocks are harmless.';
ALTER TABLE catalog_provider_policy ADD COLUMN IF NOT EXISTS purposes text[];
ALTER TABLE catalog_provider_policy ADD COLUMN IF NOT EXISTS fields text[];
ALTER TABLE catalog_provider_policy ADD COLUMN IF NOT EXISTS retention text;
ALTER TABLE catalog_provider_policy ADD COLUMN IF NOT EXISTS purge_procedure text;
ALTER TABLE catalog_provider_policy ADD COLUMN IF NOT EXISTS quota text;
ALTER TABLE catalog_provider_policy ADD COLUMN IF NOT EXISTS terms_source text;
ALTER TABLE catalog_provider_policy ADD COLUMN IF NOT EXISTS terms_checked_at timestamptz;
ALTER TABLE catalog_provider_policy ADD COLUMN IF NOT EXISTS next_review_at timestamptz;
ALTER TABLE catalog_provider_policy ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES app_user(id) ON DELETE SET NULL;
UPDATE catalog_provider_policy SET status='REVIEW_REQUIRED' WHERE status='AUTHORIZED' AND (cardinality(purposes) IS NULL OR cardinality(fields) IS NULL OR retention IS NULL OR purge_procedure IS NULL OR quota IS NULL OR terms_source IS NULL OR terms_checked_at IS NULL OR next_review_at IS NULL OR reviewed_by IS NULL);
CREATE OR REPLACE FUNCTION enforce_complete_provider_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status='AUTHORIZED' AND (cardinality(NEW.purposes) IS NULL OR cardinality(NEW.fields) IS NULL OR NEW.retention IS NULL OR NEW.purge_procedure IS NULL OR NEW.quota IS NULL OR NEW.terms_source IS NULL OR NEW.terms_checked_at IS NULL OR NEW.next_review_at IS NULL OR NEW.next_review_at<=now()) THEN NEW.status='REVIEW_REQUIRED'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS catalog_provider_policy_completeness ON catalog_provider_policy;
CREATE TRIGGER catalog_provider_policy_completeness BEFORE INSERT OR UPDATE ON catalog_provider_policy FOR EACH ROW EXECUTE FUNCTION enforce_complete_provider_policy();

DELETE FROM catalog_provider_policy;
INSERT INTO catalog_provider_policy(provider,status,version,license,attribution,purposes,fields,retention,purge_procedure,quota,terms_source,terms_checked_at,next_review_at)
VALUES ('anilist','AUTHORIZED','graphql-v1','AniList terms','AniList metadata and cover',ARRAY['identity','metadata','cover'],ARRAY['titles','synonyms','ids','metadata','image'],'while the work is owned','delete catalogue assertions, ids and image when unowned','on-demand, bounded','https://anilist.co/terms','2026-08-03','2027-08-03');
ALTER TABLE media_cover ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'unknown';
ALTER TABLE media_cover ADD COLUMN IF NOT EXISTS attribution text;
ALTER TABLE media_cover ADD COLUMN IF NOT EXISTS content_sha256 text;
ALTER TABLE media_cover ADD COLUMN IF NOT EXISTS asset_sha256 text;
ALTER TABLE media_cover ALTER COLUMN data DROP NOT NULL;
CREATE INDEX IF NOT EXISTS media_cover_content_sha256_idx ON media_cover(content_sha256) WHERE content_sha256 IS NOT NULL;
CREATE TABLE IF NOT EXISTS catalog_image_asset(sha256 text PRIMARY KEY,mime_type text NOT NULL,data text NOT NULL,width integer NOT NULL,height integer NOT NULL,byte_size integer NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS metadata_assertion(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  field text NOT NULL, value jsonb NOT NULL, provider text NOT NULL, source_url text NOT NULL,
  confidence numeric(4,3) NOT NULL, asserted_at timestamptz NOT NULL DEFAULT now(), attribution text,
  UNIQUE(media_id,field,provider,source_url)
);
CREATE INDEX IF NOT EXISTS metadata_assertion_media_field_idx ON metadata_assertion(media_id,field,asserted_at DESC);
CREATE TABLE IF NOT EXISTS provider_request_gate(provider text PRIMARY KEY,next_allowed_at timestamptz NOT NULL DEFAULT now(),blocked_until timestamptz,max_in_flight integer NOT NULL DEFAULT 2,in_flight integer NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE provider_request_gate ADD COLUMN IF NOT EXISTS max_in_flight integer NOT NULL DEFAULT 2;
ALTER TABLE provider_request_gate ADD COLUMN IF NOT EXISTS in_flight integer NOT NULL DEFAULT 0;
INSERT INTO provider_request_gate(provider,max_in_flight) VALUES ('anilist',2),('mangaupdates',2),('mangadex',1) ON CONFLICT(provider) DO NOTHING;
CREATE TABLE IF NOT EXISTS provider_request_waitlist (
  id uuid PRIMARY KEY, provider text NOT NULL CHECK(provider IN ('anilist','mangaupdates','mangadex')),
  request_kind text NOT NULL, priority integer NOT NULL DEFAULT 50,
  scope_key text, user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  state text NOT NULL CHECK(state IN ('WAITING','RUNNING','COMPLETED','FAILED')),
  not_before timestamptz NOT NULL DEFAULT now(),attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,completed_at timestamptz,last_error text
);
CREATE INDEX IF NOT EXISTS provider_request_waitlist_dispatch_idx ON provider_request_waitlist(provider,state,priority DESC,not_before,created_at);
ALTER TABLE media_enrichment_state ADD COLUMN IF NOT EXISTS resolution_code text;
ALTER TABLE media_enrichment_state ADD COLUMN IF NOT EXISTS match_confidence numeric(4,3);
ALTER TABLE media_enrichment_state ADD COLUMN IF NOT EXISTS candidate_snapshot jsonb;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='media_cover_asset_fk') THEN
    ALTER TABLE media_cover ADD CONSTRAINT media_cover_asset_fk FOREIGN KEY(asset_sha256) REFERENCES catalog_image_asset(sha256) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS media_banner(media_id text PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,source_url text,provider text NOT NULL DEFAULT 'unknown',attribution text,mime_type text NOT NULL,asset_sha256 text REFERENCES catalog_image_asset(sha256) ON DELETE RESTRICT,content_sha256 text,width integer,height integer,byte_size integer NOT NULL,status text NOT NULL CHECK(status IN ('ACTIVE','FAILED','STALE','FALLBACK')),fetched_at timestamptz NOT NULL DEFAULT now(),error text);
CREATE INDEX IF NOT EXISTS media_banner_content_sha256_idx ON media_banner(content_sha256) WHERE content_sha256 IS NOT NULL;


-- Multi-provider catalogue contract. This is deliberately separate from the
-- user-scoped reset endpoint: it is callable only with the exact destructive
-- confirmation token and does not have SECURITY DEFINER privileges.
CREATE TABLE IF NOT EXISTS provider_progress (
  media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  provider text NOT NULL,
  serialization_status text,
  latest_chapter text,
  latest_volume text,
  latest_release_at timestamptz,
  last_checked_at timestamptz,
  next_attempt_at timestamptz,
  status text NOT NULL DEFAULT 'STALE' CHECK(status IN ('ACTIVE','STALE','FAILED','REVIEW')),
  last_error text,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(media_id,provider)
);
CREATE INDEX IF NOT EXISTS provider_progress_provider_idx ON provider_progress(provider,last_checked_at);
CREATE INDEX IF NOT EXISTS provider_progress_release_idx ON provider_progress(latest_release_at);
CREATE INDEX IF NOT EXISTS media_external_id_provider_idx ON media_external_id(provider,external_id);
CREATE INDEX IF NOT EXISTS release_announcement_media_idx ON release_announcement(media_id,announced_at DESC);
CREATE INDEX IF NOT EXISTS release_announcement_release_date_idx ON release_announcement(announced_at DESC);

CREATE OR REPLACE FUNCTION favlib_reset_catalog(confirmation text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE removed integer;
  queued integer := 0;
  item record;
BEGIN
  IF confirmation IS DISTINCT FROM 'RESET-FAVLIB-CATALOG' THEN
    RAISE EXCEPTION 'RESET_CONFIRMATION_REQUIRED';
  END IF;
  -- Les œuvres encore liées à un favori actif font partie de l'inventaire
  -- utilisateur. Elles ne doivent jamais être supprimées par un reset de
  -- catalogue : la suppression en cascade détruirait aussi media_cover et
  -- forcerait un nouvel appel fournisseur pour une image déjà locale.
  DELETE FROM media m
  WHERE NOT EXISTS (
    SELECT 1 FROM bookmark_media_link l
    WHERE l.media_id=m.id AND l.status IN ('matched','accepted','review')
  );
  GET DIAGNOSTICS removed = ROW_COUNT;

  -- Le fingerprint des favoris reste volontairement inchangé. L'extension
  -- peut donc ignorer l'inventaire déjà connu ; les œuvres conservées sont
  -- réenfilées ici pour reconstruire les métadonnées sans re-télécharger les
  -- couvertures déjà ACTIVE.
  FOR item IN
    SELECT DISTINCT m.id, m.type
    FROM media m
    JOIN bookmark_media_link l ON l.media_id=m.id
      AND l.status IN ('matched','accepted','review')
  LOOP
    IF item.type='ANIME' THEN
      PERFORM graphile_worker.add_job('anilist-enrichment',jsonb_build_object('mediaId',item.id)::json,job_key := 'catalog-reset:anilist:'||item.id,max_attempts := 1);
      queued := queued + 1;
    ELSIF item.type IN ('MANGA','MANHWA','MANHUA') THEN
      PERFORM graphile_worker.add_job('mangaupdates-enrichment',jsonb_build_object('mediaId',item.id)::json,job_key := 'catalog-reset:mangaupdates:'||item.id,max_attempts := 1);
      queued := queued + 1;
    END IF;
  END LOOP;
  DELETE FROM catalog_provider_policy WHERE provider NOT IN ('anilist','mangaupdates','mangadex');
  INSERT INTO catalog_provider_policy(provider,status,version,license,attribution,purposes,fields,retention,purge_procedure,quota,terms_source,terms_checked_at,next_review_at)
  VALUES ('anilist','AUTHORIZED','graphql-v1','AniList terms','AniList metadata, themes and images',
    ARRAY['identity','metadata','themes','cover','banner'],
    ARRAY['titles','synonyms','ids','themes','genres','description','studios','relations','scores','status','format','episodes','chapters','volumes','airing','coverImage','bannerImage'],
    'while the work is owned',
    'delete assertions, identifiers and images when the work is unowned',
    'on-demand, one request per operation and work',
    'https://anilist.co/terms',current_date,current_date + interval '1 year')
  ON CONFLICT(provider) DO UPDATE SET status='AUTHORIZED',version=excluded.version,license=excluded.license,attribution=excluded.attribution,purposes=excluded.purposes,fields=excluded.fields,retention=excluded.retention,purge_procedure=excluded.purge_procedure,quota=excluded.quota,terms_source=excluded.terms_source,terms_checked_at=excluded.terms_checked_at,next_review_at=excluded.next_review_at,reviewed_at=now();
  RETURN jsonb_build_object('removedMedia',removed,'enqueued',queued);
END $$;

COMMENT ON FUNCTION favlib_reset_catalog(text) IS 'Provider catalogue reset; exact confirmation RESET-FAVLIB-CATALOG is mandatory.';

CREATE OR REPLACE FUNCTION enforce_catalog_provider_policy()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.provider NOT IN ('anilist','mangaupdates','mangadex') THEN
    RAISE EXCEPTION 'CATALOG_PROVIDER_NOT_ALLOWED';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS catalog_provider_anilist_only ON catalog_provider_policy;
DROP TRIGGER IF EXISTS catalog_provider_allowed ON catalog_provider_policy;
CREATE TRIGGER catalog_provider_allowed
  BEFORE INSERT OR UPDATE ON catalog_provider_policy
  FOR EACH ROW EXECUTE FUNCTION enforce_catalog_provider_policy();

DELETE FROM catalog_provider_policy WHERE provider='mangaupdates';
INSERT INTO catalog_provider_policy(provider,status,version,license,attribution,purposes,fields,retention,purge_procedure,quota,terms_source,terms_checked_at,next_review_at)
VALUES
 ('mangaupdates','AUTHORIZED','api-v1','MangaUpdates terms','MangaUpdates progression and release observations',ARRAY['progression','releases'],ARRAY['externalId','titles','status','chapter','volume','releaseDate'],'while the work is owned','delete provider progress, identifiers and announcements when unowned','global release feed every 5 minutes; bounded fallback search','https://www.mangaupdates.com/about.html','2026-08-03','2027-08-03')
ON CONFLICT(provider) DO UPDATE SET status=excluded.status,version=excluded.version,license=excluded.license,attribution=excluded.attribution,purposes=excluded.purposes,fields=excluded.fields,retention=excluded.retention,purge_procedure=excluded.purge_procedure,quota=excluded.quota,terms_source=excluded.terms_source,terms_checked_at=excluded.terms_checked_at,next_review_at=excluded.next_review_at;

INSERT INTO catalog_provider_policy(provider,status,version,license,attribution,purposes,fields,retention,purge_procedure,quota,terms_source,terms_checked_at,next_review_at)
VALUES ('mangadex','AUTHORIZED','bridge-v1','MangaDex API policy','MangaDex identity bridge only',ARRAY['identity-bridge'],ARRAY['uuid','titles','links.mu'],'raw bridge provenance while the favorite is owned','removed with the owning enrichment evidence','one concurrent request; conservative spacing','https://api.mangadex.org/docs/','2026-08-07','2027-08-07')
ON CONFLICT(provider) DO UPDATE SET status=excluded.status,version=excluded.version,attribution=excluded.attribution,purposes=excluded.purposes,fields=excluded.fields;

COMMENT ON TABLE provider_progress IS 'Owner: canonical catalog; purpose: durable provider progression and release state; export: provider provenance; retention/purge: cascade with media; restore: stale until next successful sweep.';

-- Rich read-only catalogue observations.  The normalized tables above remain the
-- query surface; these rows retain provider detail and temporal evidence.
ALTER TABLE media_title ADD COLUMN IF NOT EXISTS script text;
ALTER TABLE media_title ADD COLUMN IF NOT EXISTS title_type text;
ALTER TABLE media_title ADD COLUMN IF NOT EXISTS personal_status text;
ALTER TABLE media_title ADD COLUMN IF NOT EXISTS confidence numeric(4,3);
CREATE INDEX IF NOT EXISTS media_title_normalized_idx ON media_title(normalized_text);
CREATE INDEX IF NOT EXISTS media_title_language_idx ON media_title(language,script);
CREATE INDEX IF NOT EXISTS media_title_connector_idx ON media_title(connector);
CREATE UNIQUE INDEX IF NOT EXISTS media_title_rich_identity_unique ON media_title(media_id,normalized_text,coalesce(language,''),coalesce(script,''),kind,coalesce(connector,''));

CREATE TABLE IF NOT EXISTS provider_payload (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK(provider IN ('anilist','mangaupdates','mangadex')),
  connector_version text NOT NULL, collected_at timestamptz NOT NULL DEFAULT now(), payload_hash text NOT NULL,
  payload jsonb NOT NULL, provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  validity_status text NOT NULL CHECK(validity_status IN ('VALID','INVALID','PARTIAL','ERROR')),
  error text, is_current boolean NOT NULL DEFAULT true,
  UNIQUE(media_id,provider,connector_version,payload_hash)
);
CREATE INDEX IF NOT EXISTS provider_payload_provider_idx ON provider_payload(provider,collected_at DESC);
CREATE INDEX IF NOT EXISTS provider_payload_media_idx ON provider_payload(media_id,provider,collected_at DESC);
CREATE TABLE IF NOT EXISTS mangadex_promotion_state (
  media_id text PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE, mangadex_id text NOT NULL,
  next_attempt_at timestamptz NOT NULL, last_attempt_at timestamptz, last_error text,
  matcher_version text NOT NULL, mangaupdates_id text,
  status text NOT NULL CHECK(status IN ('PENDING','PROMOTED')), promoted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mangadex_promotion_due_idx ON mangadex_promotion_state(status,next_attempt_at);
CREATE OR REPLACE FUNCTION favlib_next_paris_monday(value timestamptz) RETURNS timestamptz LANGUAGE sql STABLE AS $$
  SELECT (((value AT TIME ZONE 'Europe/Paris')::date + CASE WHEN extract(isodow FROM value AT TIME ZONE 'Europe/Paris')::int=1 AND (value AT TIME ZONE 'Europe/Paris')::time<time '03:00' THEN 0 ELSE 8-extract(isodow FROM value AT TIME ZONE 'Europe/Paris')::int END)+time '03:00') AT TIME ZONE 'Europe/Paris'
$$;
CREATE TABLE IF NOT EXISTS provider_sync_state (
  media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE, provider text NOT NULL,
  connector_version text NOT NULL, last_payload_hash text, last_collected_at timestamptz,
  last_success_at timestamptz, status text NOT NULL, error text, attempt_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(media_id,provider,connector_version)
);
CREATE INDEX IF NOT EXISTS provider_sync_state_status_idx ON provider_sync_state(provider,status,last_collected_at);

CREATE TABLE IF NOT EXISTS media_airing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  provider text NOT NULL, episode integer NOT NULL, airing_at_utc timestamptz NOT NULL,
  source_local_time text, source_timezone text, precision text NOT NULL,
  schedule_status text NOT NULL, last_verified_at timestamptz NOT NULL, provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(media_id,provider,episode)
);
CREATE INDEX IF NOT EXISTS media_airing_utc_idx ON media_airing(airing_at_utc);
CREATE INDEX IF NOT EXISTS media_airing_media_idx ON media_airing(media_id,airing_at_utc);
CREATE TABLE IF NOT EXISTS media_airing_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), airing_id uuid NOT NULL REFERENCES media_airing(id) ON DELETE CASCADE,
  payload_id uuid REFERENCES provider_payload(id) ON DELETE SET NULL, observed_at timestamptz NOT NULL,
  payload_hash text NOT NULL, airing_at_utc timestamptz NOT NULL, provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(airing_id,payload_hash)
);
CREATE INDEX IF NOT EXISTS media_airing_observation_time_idx ON media_airing_observation(observed_at);
CREATE TABLE IF NOT EXISTS user_catalog_preference (
  user_id uuid PRIMARY KEY REFERENCES app_user(id) ON DELETE CASCADE,
  timezone text NOT NULL DEFAULT 'UTC',
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS calendar_feed (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE, label text NOT NULL, filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz, revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS calendar_feed_user_idx ON calendar_feed(user_id);
CREATE TABLE IF NOT EXISTS mangaupdates_release_observation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  provider_release_key text NOT NULL, series_id text, chapter text, volume text,
  release_date timestamptz, groups text[], languages text[], raw_title text,
  payload_id uuid REFERENCES provider_payload(id) ON DELETE SET NULL, observed_at timestamptz NOT NULL DEFAULT now(),
  payload_hash text NOT NULL, provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE(media_id,provider_release_key,payload_hash)
);
CREATE INDEX IF NOT EXISTS mangaupdates_release_observation_release_idx ON mangaupdates_release_observation(release_date,observed_at);
COMMENT ON TABLE provider_payload IS 'Provider raw payload retention is configurable; projections and provenance survive payload purge.';
COMMENT ON TABLE user_catalog_preference IS 'Personal read-only catalogue display preference; timezone is IANA and does not alter UTC instants.';

-- Canonical display-title policy. Keep this definition in bootstrap as well as
-- the latest migration because bootstrap is intentionally idempotent.
CREATE OR REPLACE FUNCTION favlib_display_title(target_media_id text, target_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE reference_title text; selected media_title%ROWTYPE; reason text;
BEGIN
  SELECT t.text INTO reference_title FROM media_title t
  WHERE t.media_id=target_media_id AND t.kind='source' AND t.connector='source-url'
  ORDER BY t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;
  IF target_user_id IS NOT NULL THEN
    SELECT t.* INTO selected FROM media_title t WHERE t.media_id=target_media_id AND t.kind='personal' AND t.provenance->>'userId'=target_user_id::text ORDER BY t.id DESC LIMIT 1;
    IF selected.id IS NOT NULL THEN RETURN jsonb_build_object('title',selected.text,'referenceTitle',reference_title,'score',1,'alias',jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,'connector',selected.connector),'reason','PERSONAL_ALIAS'); END IF;
  END IF;
  SELECT t.* INTO selected FROM media_title t WHERE t.media_id=target_media_id AND t.kind<>'personal' AND t.connector IN ('anilist','mangaupdates') AND (t.title_type='romaji' OR t.script='Latn' OR (t.script IS NULL AND t.text !~ '[ぁ-ゟァ-ヿ一-鿿]')) ORDER BY (t.title_type='romaji') DESC,(t.script='Latn') DESC,CASE t.connector WHEN 'anilist' THEN 0 ELSE 1 END,t.id DESC LIMIT 1;
  IF selected.id IS NULL THEN RETURN jsonb_build_object('title',NULL,'referenceTitle',reference_title,'score',0,'alias',NULL,'reason','NO_TITLE'); END IF;
  reason := 'ROMAJI_FALLBACK';
  RETURN jsonb_build_object('title',selected.text,'referenceTitle',reference_title,'score',0,'alias',jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,'connector',selected.connector),'reason',reason);
END $$;

DROP FUNCTION IF EXISTS purge_orphan_catalog_image_assets();

ALTER TABLE media_cover DROP CONSTRAINT IF EXISTS media_cover_media_id_fkey;
ALTER TABLE media_cover ADD CONSTRAINT media_cover_media_id_fkey FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE RESTRICT;
ALTER TABLE media_banner ADD COLUMN IF NOT EXISTS provider_external_id text;
ALTER TABLE media_banner ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE media_banner DROP CONSTRAINT IF EXISTS media_banner_media_id_fkey;
ALTER TABLE media_banner ADD CONSTRAINT media_banner_media_id_fkey FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS media_cover_provider_identity_idx ON media_cover(provider,provider_external_id);
CREATE INDEX IF NOT EXISTS media_banner_provider_identity_idx ON media_banner(provider,provider_external_id);

-- Evidence-only historical image identity recovery (no provider call).
UPDATE media_cover c SET provider_external_id=COALESCE(
  (SELECT e.external_id FROM media_external_id e WHERE e.media_id=c.media_id AND e.provider='anilist' ORDER BY e.id LIMIT 1),
  (regexp_match(c.media_id,'^anilist:([0-9]+)$'))[1],
  (regexp_match(c.source_url,'/(?:b|n)x?([0-9]+)-'))[1])
WHERE c.provider='anilist' AND c.provider_external_id IS NULL;
UPDATE media_banner b SET provider_external_id=COALESCE(
  (SELECT e.external_id FROM media_external_id e WHERE e.media_id=b.media_id AND e.provider='anilist' ORDER BY e.id LIMIT 1),
  (regexp_match(b.media_id,'^anilist:([0-9]+)$'))[1],
  (regexp_match(b.source_url,'/(?:b|n)x?([0-9]+)-'))[1])
WHERE b.provider='anilist' AND b.provider_external_id IS NULL;
UPDATE media_cover SET provenance=jsonb_set(provenance,'{externalId}',to_jsonb(provider_external_id),true)
WHERE provider='anilist' AND provider_external_id IS NOT NULL AND provenance->>'externalId' IS NULL;
UPDATE media_banner SET provenance=jsonb_set(provenance,'{externalId}',to_jsonb(provider_external_id),true)
WHERE provider='anilist' AND provider_external_id IS NOT NULL AND provenance->>'externalId' IS NULL;

-- Pipeline reset: derived provider projections only. Personal rows, media
-- identities and local image hashes are outside its deletion set.
CREATE OR REPLACE FUNCTION favlib_reset_catalog(confirmation text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE removed_titles integer := 0; removed_assertions integer := 0; queued integer := 0; item record;
BEGIN
  IF confirmation IS DISTINCT FROM 'RESET-FAVLIB-CATALOG' THEN RAISE EXCEPTION 'RESET_CONFIRMATION_REQUIRED'; END IF;
  DELETE FROM media_title WHERE connector IN ('anilist','mangaupdates'); GET DIAGNOSTICS removed_titles = ROW_COUNT;
  DELETE FROM metadata_assertion WHERE provider IN ('anilist','mangaupdates'); GET DIAGNOSTICS removed_assertions = ROW_COUNT;
  DELETE FROM provider_payload WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM provider_sync_state WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_enrichment_state WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_metadata WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM provider_progress WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_airing WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM release_announcement WHERE provider IN ('anilist','mangaupdates');
  FOR item IN SELECT DISTINCT m.id,m.type FROM media m JOIN bookmark_media_link l ON l.media_id=m.id AND l.status IN ('matched','accepted','review') LOOP
    IF item.type='ANIME' THEN PERFORM graphile_worker.add_job('anilist-enrichment',jsonb_build_object('mediaId',item.id)::json,job_key := 'catalog-reset:anilist:'||item.id,max_attempts := 1); queued := queued+1;
    ELSIF item.type IN ('MANGA','MANHWA','MANHUA') THEN PERFORM graphile_worker.add_job('mangaupdates-enrichment',jsonb_build_object('mediaId',item.id)::json,job_key := 'catalog-reset:mangaupdates:'||item.id,max_attempts := 1); queued := queued+1; END IF;
  END LOOP;
  RETURN jsonb_build_object('removedMedia',0,'removedProviderTitles',removed_titles,'removedProviderAssertions',removed_assertions,
    'preservedFavoriteMedia',(SELECT count(DISTINCT media_id) FROM bookmark_media_link WHERE media_id IS NOT NULL),
    'preservedCovers',(SELECT count(*) FROM media_cover WHERE status='ACTIVE'),'enqueued',queued);
END $$;

COMMENT ON FUNCTION favlib_reset_catalog(text) IS 'Provider-pipeline reset; preserves users, favorites, progress, devices, media and every local image asset.';

-- The clean reset is intentionally the final definition in bootstrap so a
-- bootstrap run cannot restore the old enqueueing reset implementation.
CREATE OR REPLACE FUNCTION favlib_reset_catalog(confirmation text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE removed_links integer := 0; removed_jobs integer := 0;
BEGIN
  IF confirmation IS DISTINCT FROM 'RESET-FAVLIB-CATALOG' THEN RAISE EXCEPTION 'RESET_CONFIRMATION_REQUIRED'; END IF;
  IF to_regclass('graphile_worker._private_jobs') IS NOT NULL THEN DELETE FROM graphile_worker._private_jobs; GET DIAGNOSTICS removed_jobs = ROW_COUNT; END IF;
  IF to_regclass('graphile_worker._private_job_queues') IS NOT NULL THEN DELETE FROM graphile_worker._private_job_queues; END IF;
  DELETE FROM personal_notification; DELETE FROM favorite_progress; DELETE FROM progression_observation;
  DELETE FROM release_origin; DELETE FROM source_snapshot; DELETE FROM url_check; DELETE FROM favorite_update_log;
  DELETE FROM classification_run; DELETE FROM metadata_attempt; DELETE FROM extension_metadata_receipt;
  DELETE FROM reconciliation_cursor; DELETE FROM bookmark_import_item; DELETE FROM bookmark_import_batch;
  DELETE FROM bookmark_media_link; GET DIAGNOSTICS removed_links = ROW_COUNT;
  DELETE FROM media_enrichment_state; DELETE FROM media_metadata;
  DELETE FROM metadata_assertion WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM provider_payload WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM provider_sync_state WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM provider_progress WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_external_id WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_title WHERE connector IN ('anilist','mangaupdates');
  DELETE FROM media_airing WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM release_announcement WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media m WHERE NOT EXISTS (SELECT 1 FROM media_cover c WHERE c.media_id=m.id);
  UPDATE extension_device SET last_sync_at=NULL,verified_sync_at=NULL;
  RETURN jsonb_build_object('removedLinks',removed_links,'removedJobs',removed_jobs,'preservedUsers',(SELECT count(*) FROM app_user),'preservedMedia',(SELECT count(*) FROM media),'preservedCovers',(SELECT count(*) FROM media_cover),'preservedImageAssets',(SELECT count(*) FROM catalog_image_asset),'enqueued',0);
END $$;
COMMENT ON FUNCTION favlib_reset_catalog(text) IS 'Clean reset; preserves users, covers and local image assets only.';

-- Kept at the end so an idempotent bootstrap never restores the old
-- personal-first projection. Migration 0014 supplies the full deterministic
-- cleaner and local repair for already populated catalogues.
CREATE OR REPLACE FUNCTION favlib_display_title(target_media_id text, target_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE selected media_title%ROWTYPE; reference_title text;
BEGIN
  SELECT t.text INTO reference_title FROM media_title t WHERE t.media_id=target_media_id AND t.kind='source' ORDER BY t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;
  SELECT t.* INTO selected FROM media_title t WHERE t.media_id=target_media_id AND t.kind='official' AND t.connector IN ('anilist','mangaupdates') AND t.title_type='canonical' ORDER BY CASE t.connector WHEN 'anilist' THEN 0 ELSE 1 END,t.id DESC LIMIT 1;
  IF selected.id IS NULL THEN SELECT t.* INTO selected FROM media_title t WHERE t.media_id=target_media_id AND t.kind IN ('official','supplier') AND t.connector IN ('anilist','mangaupdates') ORDER BY (t.kind='official') DESC,(t.title_type='official') DESC,t.confidence DESC NULLS LAST,t.id DESC LIMIT 1; END IF;
  IF selected.id IS NULL THEN SELECT t.* INTO selected FROM media_title t WHERE t.media_id=target_media_id AND t.kind='source' ORDER BY t.confidence DESC NULLS LAST,t.id DESC LIMIT 1; END IF;
  IF selected.id IS NULL AND target_user_id IS NOT NULL THEN SELECT t.* INTO selected FROM media_title t WHERE t.media_id=target_media_id AND t.kind='personal' AND t.provenance->>'userId'=target_user_id::text ORDER BY t.id DESC LIMIT 1; END IF;
  RETURN jsonb_build_object('title',selected.text,'referenceTitle',reference_title,'score',CASE WHEN selected.id IS NULL THEN 0 WHEN selected.connector IN ('anilist','mangaupdates') THEN 1 ELSE .5 END,'alias',CASE WHEN selected.id IS NULL THEN NULL ELSE jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,'connector',selected.connector) END,'reason',CASE WHEN selected.connector IN ('anilist','mangaupdates') THEN 'PROVIDER_CANONICAL' WHEN selected.kind='source' THEN 'SOURCE_CLEAN' WHEN selected.id IS NULL THEN 'NO_TITLE' ELSE 'PERSONAL_CLEAN' END);
END $$;

-- Final canonical display policy used by bootstrap as well as migration 0013.
CREATE OR REPLACE FUNCTION favlib_clean_display_title(value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE s text := coalesce(value,'');
BEGIN
  s:=regexp_replace(s,'\s*([-–—|·:]\s*)?(chapter|chapitre|chap|ch\.?|episode|épisode|ep\.?|volume|vol\.?|season|saison)\s*#?[0-9][0-9.\-a-z]*.*$','','i');
  s:=regexp_replace(s,'\s*([-–—|·:]\s*)?(vostfr|vf|vo|sub|dub|scan|scans)\b.*$','','i');
  s:=regexp_replace(s,'\s*([-–—|·:]\s*)?(voiranime|mangakakalot|anime-sama|anime sama|japscan|lelscan|manganato|mangadex)\b.*$','','i');
  RETURN nullif(trim(regexp_replace(s,'[|·:—–-]+$','','g')),'');
END $$;
CREATE OR REPLACE FUNCTION favlib_display_title(target_media_id text, target_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE selected media_title%ROWTYPE; reference_title text; shown text;
BEGIN
 SELECT favlib_clean_display_title(t.text) INTO reference_title FROM media_title t WHERE t.media_id=target_media_id AND t.kind='source' ORDER BY t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;
 SELECT t.* INTO selected FROM media_title t WHERE t.media_id=target_media_id AND t.kind<>'personal' AND t.connector IN ('anilist','mangaupdates') AND favlib_clean_display_title(t.text) IS NOT NULL ORDER BY (t.title_type='canonical') DESC,(t.kind='official') DESC,(t.title_type='romaji') DESC,(t.connector='anilist') DESC,t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;
 IF selected.id IS NOT NULL THEN shown:=favlib_clean_display_title(selected.text); RETURN jsonb_build_object('title',shown,'referenceTitle',reference_title,'score',1,'alias',jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,'connector',selected.connector),'reason','PROVIDER_CANONICAL'); END IF;
 SELECT t.* INTO selected FROM media_title t WHERE t.media_id=target_media_id AND t.kind='source' AND favlib_clean_display_title(t.text) IS NOT NULL ORDER BY t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;
 IF selected.id IS NOT NULL THEN shown:=favlib_clean_display_title(selected.text); RETURN jsonb_build_object('title',shown,'referenceTitle',reference_title,'score',.9,'alias',jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,'connector',selected.connector),'reason','SOURCE_CLEAN'); END IF;
 IF target_user_id IS NOT NULL THEN
   SELECT t.* INTO selected FROM media_title t WHERE t.media_id=target_media_id AND t.kind='personal' AND t.provenance->>'userId'=target_user_id::text AND favlib_clean_display_title(t.text) IS NOT NULL ORDER BY t.id DESC LIMIT 1;
   IF selected.id IS NOT NULL THEN shown:=favlib_clean_display_title(selected.text); RETURN jsonb_build_object('title',shown,'referenceTitle',reference_title,'score',.5,'alias',jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,'connector',selected.connector),'reason','PERSONAL_CLEAN'); END IF;
 END IF;
 RETURN jsonb_build_object('title',NULL,'referenceTitle',reference_title,'score',0,'alias',NULL,'reason','NO_TITLE');
END $$;

-- Final readable-title policy. This must remain the last display-title
-- definition in the idempotent bootstrap.
CREATE OR REPLACE FUNCTION favlib_display_title(target_media_id text, target_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE selected media_title%ROWTYPE; reference_title text; shown text;
BEGIN
  SELECT favlib_clean_display_title(t.text) INTO reference_title FROM media_title t
  WHERE t.media_id=target_media_id AND t.kind='source'
  ORDER BY t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;
  SELECT t.* INTO selected FROM media_title t
  WHERE t.media_id=target_media_id AND t.kind<>'personal'
    AND t.connector IN ('anilist','mangaupdates')
    AND favlib_clean_display_title(t.text) IS NOT NULL
    AND ((t.kind='translation' AND t.language='en') OR t.title_type='romaji' OR t.script='Latn' OR t.text ~ '[A-Za-zÀ-ÖØ-öø-ÿ]')
  ORDER BY (t.kind='translation' AND t.language='en') DESC,
    (t.title_type='romaji') DESC,(t.script='Latn') DESC,
    (t.title_type='canonical') DESC,t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;
  IF selected.id IS NOT NULL THEN
    shown:=favlib_clean_display_title(selected.text);
    RETURN jsonb_build_object('title',shown,'referenceTitle',reference_title,'score',1,
      'alias',jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,'connector',selected.connector),
      'reason',CASE WHEN selected.kind='translation' AND selected.language='en' THEN 'ENGLISH_FALLBACK' WHEN selected.title_type='romaji' THEN 'ROMAJI_FALLBACK' WHEN selected.title_type='canonical' THEN 'PROVIDER_CANONICAL' ELSE 'PROVIDER_LATIN_FALLBACK' END);
  END IF;
  RETURN jsonb_build_object('title',reference_title,'referenceTitle',reference_title,'score',CASE WHEN reference_title IS NULL THEN 0 ELSE 1 END,'alias',NULL,'reason',CASE WHEN reference_title IS NULL THEN 'NO_LATIN_TITLE' ELSE 'SOURCE_CLEAN' END);
END $$;

-- This is intentionally the last reset definition in the bootstrap.
CREATE OR REPLACE FUNCTION favlib_reset_catalog(confirmation text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE removed_titles integer := 0; removed_assertions integer := 0;
BEGIN
  IF confirmation IS DISTINCT FROM 'RESET-FAVLIB-CATALOG' THEN RAISE EXCEPTION 'RESET_CONFIRMATION_REQUIRED'; END IF;
  DELETE FROM media_title WHERE connector IN ('anilist','mangaupdates'); GET DIAGNOSTICS removed_titles = ROW_COUNT;
  DELETE FROM metadata_assertion WHERE provider IN ('anilist','mangaupdates'); GET DIAGNOSTICS removed_assertions = ROW_COUNT;
  DELETE FROM provider_payload WHERE provider IN ('anilist','mangaupdates'); DELETE FROM provider_sync_state WHERE provider IN ('anilist','mangaupdates'); DELETE FROM media_enrichment_state WHERE provider IN ('anilist','mangaupdates'); DELETE FROM media_metadata WHERE provider IN ('anilist','mangaupdates'); DELETE FROM provider_progress WHERE provider IN ('anilist','mangaupdates'); DELETE FROM media_external_id WHERE provider IN ('anilist','mangaupdates'); DELETE FROM media_airing WHERE provider IN ('anilist','mangaupdates'); DELETE FROM release_announcement WHERE provider IN ('anilist','mangaupdates');
  RETURN jsonb_build_object('removedMedia',0,'removedProviderTitles',removed_titles,'removedProviderAssertions',removed_assertions,'preservedFavoriteMedia',(SELECT count(DISTINCT media_id) FROM bookmark_media_link WHERE media_id IS NOT NULL AND status IN ('matched','accepted')),'preservedCovers',(SELECT count(*) FROM media_cover WHERE status='ACTIVE'),'preservedImageAssets',(SELECT count(*) FROM catalog_image_asset),'enqueued',0);
END $$;
