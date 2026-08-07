ALTER TABLE media_cover ADD COLUMN IF NOT EXISTS provider_external_id text;
ALTER TABLE media_cover ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE media_banner ADD COLUMN IF NOT EXISTS provider_external_id text;
ALTER TABLE media_banner ADD COLUMN IF NOT EXISTS provenance jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Local images outlive recalculated catalog metadata. A media deletion must be
-- refused until an explicit, targeted administrative image workflow handles
-- the association; it must never cascade.
ALTER TABLE media_cover DROP CONSTRAINT IF EXISTS media_cover_media_id_fkey;
ALTER TABLE media_cover ADD CONSTRAINT media_cover_media_id_fkey FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE RESTRICT;
ALTER TABLE media_banner DROP CONSTRAINT IF EXISTS media_banner_media_id_fkey;
ALTER TABLE media_banner ADD CONSTRAINT media_banner_media_id_fkey FOREIGN KEY(media_id) REFERENCES media(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS media_cover_provider_identity_idx ON media_cover(provider,provider_external_id);
CREATE INDEX IF NOT EXISTS media_banner_provider_identity_idx ON media_banner(provider,provider_external_id);

UPDATE media_cover SET provenance=jsonb_build_object('provider',provider,'externalId',provider_external_id,'sourceUrl',source_url,'contentSha256',content_sha256)
WHERE provenance='{}'::jsonb;
