-- A catalog reset must not remove identities that are still owned by a
-- favorite. Their media_cover rows are local assets and must remain reusable.
CREATE OR REPLACE FUNCTION favlib_reset_catalog(confirmation text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE removed_titles integer := 0;
  removed_assertions integer := 0;
  queued integer := 0;
  item record;
BEGIN
  IF confirmation IS DISTINCT FROM 'RESET-FAVLIB-CATALOG' THEN
    RAISE EXCEPTION 'RESET_CONFIRMATION_REQUIRED';
  END IF;

  DELETE FROM media_title WHERE connector IN ('anilist','mangaupdates');
  GET DIAGNOSTICS removed_titles = ROW_COUNT;
  DELETE FROM metadata_assertion WHERE provider IN ('anilist','mangaupdates');
  GET DIAGNOSTICS removed_assertions = ROW_COUNT;
  DELETE FROM provider_payload WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM provider_sync_state WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_enrichment_state WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_metadata WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM provider_progress WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_airing WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM release_announcement WHERE provider IN ('anilist','mangaupdates');

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

  DELETE FROM catalog_provider_policy
  WHERE provider NOT IN ('anilist','mangaupdates');

  RETURN jsonb_build_object(
    'removedMedia',0,
    'removedProviderTitles',removed_titles,
    'removedProviderAssertions',removed_assertions,
    'preservedFavoriteMedia',(
      SELECT count(*) FROM media m
      WHERE EXISTS (
        SELECT 1 FROM bookmark_media_link l
        WHERE l.media_id=m.id
          AND l.status IN ('matched','accepted','review')
      )
    ),
    'preservedCovers',(
      SELECT count(*) FROM media_cover c
      WHERE c.status='ACTIVE'
        AND EXISTS (
          SELECT 1 FROM bookmark_media_link l
          WHERE l.media_id=c.media_id
            AND l.status IN ('matched','accepted','review')
        )
    ),
    'enqueued',queued
  );
END $$;
