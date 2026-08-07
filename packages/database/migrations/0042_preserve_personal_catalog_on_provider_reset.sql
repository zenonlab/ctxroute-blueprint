-- Reset only provider-derived catalogue state. Personal favorites, progress,
-- devices, media and content-addressed image assets are user data and survive.
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
  RETURN jsonb_build_object('removedMedia',0,'removedProviderTitles',removed_titles,'removedProviderAssertions',removed_assertions,
    'preservedFavoriteMedia',(SELECT count(DISTINCT media_id) FROM bookmark_media_link WHERE media_id IS NOT NULL AND status IN ('matched','accepted')),
    'preservedCovers',(SELECT count(*) FROM media_cover WHERE status='ACTIVE'),'preservedImageAssets',(SELECT count(*) FROM catalog_image_asset),'enqueued',0);
END $$;

COMMENT ON FUNCTION favlib_reset_catalog(text) IS 'Provider-pipeline reset; preserves users, active favorites, progress, devices, media, covers and local image assets.';
