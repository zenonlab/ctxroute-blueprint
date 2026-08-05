-- Clean reset for the favorite-resolution loop. Media rows and local image
-- assets are deliberately retained; ownership and provider state are not.
CREATE OR REPLACE FUNCTION favlib_reset_catalog(confirmation text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
  removed_links integer := 0;
  removed_jobs integer := 0;
BEGIN
  IF confirmation IS DISTINCT FROM 'RESET-FAVLIB-CATALOG' THEN
    RAISE EXCEPTION 'RESET_CONFIRMATION_REQUIRED';
  END IF;

  IF to_regclass('graphile_worker._private_jobs') IS NOT NULL THEN
    DELETE FROM graphile_worker._private_jobs;
    GET DIAGNOSTICS removed_jobs = ROW_COUNT;
  END IF;
  IF to_regclass('graphile_worker._private_job_queues') IS NOT NULL THEN
    DELETE FROM graphile_worker._private_job_queues;
  END IF;

  DELETE FROM personal_notification;
  DELETE FROM favorite_progress;
  DELETE FROM progression_observation;
  DELETE FROM release_origin;
  DELETE FROM source_snapshot;
  DELETE FROM url_check;
  DELETE FROM favorite_update_log;
  DELETE FROM classification_run;
  DELETE FROM metadata_attempt;
  DELETE FROM extension_metadata_receipt;
  DELETE FROM reconciliation_cursor;
  DELETE FROM bookmark_import_item;
  DELETE FROM bookmark_import_batch;
  DELETE FROM bookmark_media_link;
  GET DIAGNOSTICS removed_links = ROW_COUNT;

  DELETE FROM media_enrichment_state;
  DELETE FROM media_metadata;
  DELETE FROM metadata_assertion WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM provider_payload WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM provider_sync_state WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM provider_progress WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_external_id WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_title WHERE connector IN ('anilist','mangaupdates');
  DELETE FROM media_airing WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM release_announcement WHERE provider IN ('anilist','mangaupdates');

  UPDATE extension_device SET last_sync_at=NULL,verified_sync_at=NULL;
  RETURN jsonb_build_object('removedLinks',removed_links,'removedJobs',removed_jobs,
    'preservedUsers',(SELECT count(*) FROM app_user),
    'preservedMedia',(SELECT count(*) FROM media),
    'preservedCovers',(SELECT count(*) FROM media_cover),
    'preservedImageAssets',(SELECT count(*) FROM catalog_image_asset),
    'enqueued',0);
END $$;
