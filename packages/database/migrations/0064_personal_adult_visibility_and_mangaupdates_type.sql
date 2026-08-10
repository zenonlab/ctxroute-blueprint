ALTER TABLE user_catalog_preference
  ADD COLUMN IF NOT EXISTS allow_adult boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN user_catalog_preference.allow_adult IS
  'Owner: user; purpose: explicit opt-in for complete works whose exact provider taxonomy is blocked; export: account export; retention/purge: cascade with user; restore: remains opt-in and defaults false.';

CREATE OR REPLACE FUNCTION favlib_content_allowed(input_media_id text,input_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT preference.allow_adult FROM user_catalog_preference preference WHERE preference.user_id=input_user_id),false)
    OR NOT EXISTS (
      SELECT 1 FROM metadata_assertion assertion
      CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(assertion.value)='array' THEN assertion.value ELSE '[]'::jsonb END) taxonomy_value
      WHERE assertion.media_id=input_media_id AND jsonb_typeof(assertion.value)='array'
        AND (
          assertion.field='genres' AND btrim(regexp_replace(translate(lower(taxonomy_value),'áàâäãåçéèêëíìîïñóòôöõúùûüýÿ','aaaaaaceeeeiiiinooooouuuuyy'),'[^[:alnum:]]+',' ','g'))=ANY(ARRAY['adult','erotica','hentai','smut']::text[])
          OR assertion.field='categories' AND btrim(regexp_replace(translate(lower(taxonomy_value),'áàâäãåçéèêëíìîïñóòôöõúùûüýÿ','aaaaaaceeeeiiiinooooouuuuyy'),'[^[:alnum:]]+',' ','g'))=ANY(ARRAY['18','adult','erotica','explicit sex','explicit sexual content','graphic sex','hardcore','hentai','lolicon','pornographic content','pornography','sexual content','shotacon','smut']::text[])
        )
    )
$$;

CREATE OR REPLACE FUNCTION favlib_recalculate_user_content_visibility(input_user_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE bookmark_import_item item SET
    classification_status=CASE WHEN favlib_content_allowed(link.media_id,input_user_id)
      THEN CASE WHEN link.status='review' THEN 'review' ELSE 'recognized' END ELSE 'excluded' END,
    classification_reason=CASE WHEN favlib_content_allowed(link.media_id,input_user_id)
      THEN CASE WHEN link.status='review' THEN 'PENDING' ELSE 'CONTENT_PREFERENCE_ALLOWED' END ELSE 'BLOCKED_CONTENT_TAXONOMY' END
  FROM bookmark_media_link link
  WHERE item.user_id=input_user_id AND link.user_id=item.user_id
    AND link.installation_id=item.installation_id AND link.bookmark_id=item.bookmark_id
    AND link.media_id IS NOT NULL AND item.event<>'removed'
    AND (item.classification_reason='BLOCKED_CONTENT_TAXONOMY' OR NOT favlib_content_allowed(link.media_id,input_user_id));

  UPDATE favorite_review review SET status='PENDING',reason=NULL,decision=NULL,resolved_at=NULL
  WHERE review.user_id=input_user_id AND review.status='NO_MATCH'
    AND review.reason='BLOCKED_CONTENT_TAXONOMY' AND review.decision->>'kind'='content-excluded';
END $$;

-- Reopen only automatic technical exclusions. User choices and all personal
-- favorites/progress remain untouched.
UPDATE favorite_review SET status='PENDING',reason=NULL,decision=NULL,resolved_at=NULL
WHERE status='NO_MATCH' AND reason='BLOCKED_CONTENT_TAXONOMY' AND decision->>'kind'='content-excluded';

UPDATE media_enrichment_state SET status='PENDING',error_code=NULL,resolution_code=NULL,
  invalidated_at=now(),next_attempt_at=NULL,updated_at=now()
WHERE error_code='BLOCKED_CONTENT_TAXONOMY' OR resolution_code='BLOCKED_CONTENT_TAXONOMY';

-- Recover MangaUpdates media types from retained provider evidence. Raw values
-- remain in provider_profile/provider_payload as provenance.
WITH proved AS (
  SELECT DISTINCT ON (external.media_id) external.media_id,
    CASE lower(btrim(COALESCE(NULLIF(profile.type,'UNKNOWN'),payload.payload->>'type',payload.payload#>>'{series,type}')))
      WHEN 'manga' THEN 'MANGA' WHEN 'manhwa' THEN 'MANHWA' WHEN 'manhua' THEN 'MANHUA' END AS media_type
  FROM media_external_id external
  LEFT JOIN provider_profile profile ON profile.provider='mangaupdates' AND profile.provider_id=external.external_id
  LEFT JOIN provider_payload payload ON payload.media_id=external.media_id AND payload.provider='mangaupdates' AND payload.is_current
  WHERE external.provider='mangaupdates'
  ORDER BY external.media_id,profile.last_seen_at DESC NULLS LAST,payload.collected_at DESC NULLS LAST
)
UPDATE media SET type=proved.media_type,updated_at=now() FROM proved
WHERE media.id=proved.media_id AND proved.media_type IS NOT NULL AND media.type<>proved.media_type;

UPDATE media_enrichment_state state SET invalidated_at=now(),next_attempt_at=NULL,updated_at=now()
WHERE state.provider='mangaupdates' AND state.purpose='metadata'
  AND EXISTS(SELECT 1 FROM media_external_id external WHERE external.media_id=state.media_id AND external.provider='mangaupdates')
  AND NOT EXISTS(
    SELECT 1 FROM provider_profile profile JOIN media_external_id external
      ON external.provider='mangaupdates' AND external.external_id=profile.provider_id
    WHERE external.media_id=state.media_id AND lower(btrim(profile.type)) IN ('manga','manhwa','manhua')
  ) AND NOT EXISTS(
    SELECT 1 FROM provider_payload payload WHERE payload.media_id=state.media_id AND payload.provider='mangaupdates'
      AND payload.is_current AND lower(btrim(COALESCE(payload.payload->>'type',payload.payload#>>'{series,type}'))) IN ('manga','manhwa','manhua')
  );

SELECT graphile_worker.add_job('mangaupdates-enrichment',jsonb_build_object('mediaId',media.id,'forceRefresh',true)::json,
  job_key := 'mangaupdates-type-backfill:'||media.id,max_attempts := 3,job_key_mode := 'replace')
FROM media WHERE type IN ('MANGA','MANHWA','MANHUA')
  AND EXISTS(SELECT 1 FROM media_external_id external WHERE external.media_id=media.id AND external.provider='mangaupdates')
  AND NOT EXISTS(
    SELECT 1 FROM provider_profile profile JOIN media_external_id external
      ON external.provider='mangaupdates' AND external.external_id=profile.provider_id
    WHERE external.media_id=media.id AND lower(btrim(profile.type)) IN ('manga','manhwa','manhua')
  ) AND NOT EXISTS(
    SELECT 1 FROM provider_payload payload WHERE payload.media_id=media.id AND payload.provider='mangaupdates'
      AND payload.is_current AND lower(btrim(COALESCE(payload.payload->>'type',payload.payload#>>'{series,type}'))) IN ('manga','manhwa','manhua')
  );

SELECT favlib_recalculate_user_content_visibility(id) FROM app_user;
