-- Canonical display titles never expose bookmark/release slop. Raw titles
-- remain in media_title for provenance and search.
CREATE TABLE IF NOT EXISTS media_identity_merge (
  source_media_id text PRIMARY KEY REFERENCES media(id) ON DELETE CASCADE,
  target_media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  provider text NOT NULL, external_id text NOT NULL, evidence jsonb NOT NULL,
  merged_at timestamptz NOT NULL DEFAULT now(), CHECK(source_media_id<>target_media_id)
);
CREATE OR REPLACE FUNCTION merge_media_identity(source_id text,target_id text,merge_provider text,merge_external_id text,merge_evidence jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF source_id=target_id THEN RETURN; END IF;
  INSERT INTO media_identity_merge(source_media_id,target_media_id,provider,external_id,evidence)
    VALUES(source_id,target_id,merge_provider,merge_external_id,merge_evidence)
    ON CONFLICT(source_media_id) DO UPDATE SET target_media_id=excluded.target_media_id,provider=excluded.provider,external_id=excluded.external_id,evidence=excluded.evidence,merged_at=now();
  INSERT INTO media_title(media_id,text,normalized_text,language,script,kind,title_type,personal_status,connector,confidence,provenance)
    SELECT target_id,text,normalized_text,language,script,kind,title_type,personal_status,connector,confidence,provenance FROM media_title WHERE media_id=source_id ON CONFLICT DO NOTHING;
  INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence,asserted_at,attribution)
    SELECT target_id,field,value,provider,source_url,confidence,asserted_at,attribution FROM metadata_assertion WHERE media_id=source_id ON CONFLICT DO NOTHING;
  UPDATE media_external_id SET media_id=target_id WHERE media_id=source_id;
  UPDATE bookmark_media_link SET media_id=target_id WHERE media_id=source_id;
  UPDATE release_announcement SET media_id=target_id WHERE media_id=source_id;
  UPDATE release_origin SET media_id=target_id WHERE media_id=source_id;
END $$;

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
  SELECT favlib_clean_display_title(t.text) INTO reference_title
  FROM media_title t WHERE t.media_id=target_media_id AND t.kind='source'
  ORDER BY t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;

  -- Provider/canonical titles always win over source and personal input.
  SELECT t.* INTO selected FROM media_title t
  WHERE t.media_id=target_media_id AND t.kind<>'personal'
    AND t.connector IN ('anilist','mangaupdates')
    AND favlib_clean_display_title(t.text) IS NOT NULL
  ORDER BY (t.title_type='canonical') DESC,(t.kind='official') DESC,
    (t.title_type='romaji') DESC,(t.connector='anilist') DESC,t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;
  IF selected.id IS NOT NULL THEN
    shown:=favlib_clean_display_title(selected.text);
    RETURN jsonb_build_object('title',shown,'referenceTitle',reference_title,'score',1,'alias',jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,'connector',selected.connector),'reason','PROVIDER_CANONICAL');
  END IF;

  SELECT t.* INTO selected FROM media_title t
  WHERE t.media_id=target_media_id AND t.kind='source' AND favlib_clean_display_title(t.text) IS NOT NULL
  ORDER BY t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;
  IF selected.id IS NOT NULL THEN
    shown:=favlib_clean_display_title(selected.text);
    RETURN jsonb_build_object('title',shown,'referenceTitle',reference_title,'score',.9,'alias',jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,'connector',selected.connector),'reason','SOURCE_CLEAN');
  END IF;

  IF target_user_id IS NOT NULL THEN
    SELECT t.* INTO selected FROM media_title t
    WHERE t.media_id=target_media_id AND t.kind='personal' AND t.provenance->>'userId'=target_user_id::text
      AND favlib_clean_display_title(t.text) IS NOT NULL
    ORDER BY t.id DESC LIMIT 1;
    IF selected.id IS NOT NULL THEN
      shown:=favlib_clean_display_title(selected.text);
      RETURN jsonb_build_object('title',shown,'referenceTitle',reference_title,'score',.5,'alias',jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,'connector',selected.connector),'reason','PERSONAL_CLEAN');
    END IF;
  END IF;
  RETURN jsonb_build_object('title',NULL,'referenceTitle',reference_title,'score',0,'alias',NULL,'reason','NO_TITLE');
END $$;

-- Keep the reset a reset: it invalidates local inventory and provider state,
-- but it never inserts Graphile jobs. A subsequent sync explicitly requeues.
CREATE OR REPLACE FUNCTION favlib_reset_catalog(confirmation text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE removed_links integer:=0; removed_jobs integer:=0;
BEGIN
  IF confirmation IS DISTINCT FROM 'RESET-FAVLIB-CATALOG' THEN RAISE EXCEPTION 'RESET_CONFIRMATION_REQUIRED'; END IF;
  IF to_regclass('graphile_worker._private_jobs') IS NOT NULL THEN DELETE FROM graphile_worker._private_jobs; GET DIAGNOSTICS removed_jobs=ROW_COUNT; END IF;
  IF to_regclass('graphile_worker._private_job_queues') IS NOT NULL THEN DELETE FROM graphile_worker._private_job_queues; END IF;
  DELETE FROM personal_notification; DELETE FROM favorite_progress; DELETE FROM progression_observation;
  DELETE FROM release_origin; DELETE FROM source_snapshot; DELETE FROM url_check; DELETE FROM favorite_update_log;
  DELETE FROM classification_run; DELETE FROM metadata_attempt; DELETE FROM extension_metadata_receipt;
  DELETE FROM reconciliation_cursor; DELETE FROM bookmark_import_item; DELETE FROM bookmark_import_batch;
  DELETE FROM bookmark_media_link; GET DIAGNOSTICS removed_links=ROW_COUNT;
  DELETE FROM media_enrichment_state; DELETE FROM media_metadata;
  DELETE FROM metadata_assertion WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM provider_payload WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM provider_sync_state WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM provider_progress WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_external_id WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM media_title WHERE connector IN ('anilist','mangaupdates');
  DELETE FROM media_airing WHERE provider IN ('anilist','mangaupdates');
  DELETE FROM release_announcement WHERE provider IN ('anilist','mangaupdates');
  UPDATE extension_device SET last_sync_at=NULL,verified_sync_at=NULL;
  RETURN jsonb_build_object('removedLinks',removed_links,'removedJobs',removed_jobs,'preservedUsers',(SELECT count(*) FROM app_user),'preservedMedia',(SELECT count(*) FROM media),'preservedCovers',(SELECT count(*) FROM media_cover),'preservedImageAssets',(SELECT count(*) FROM catalog_image_asset),'enqueued',0);
END $$;
