-- Presentation only: retain native provider aliases, but never select Japanese
-- script for display when choosing a catalogue title. AniList romaji wins over
-- every other provider alias; MangaUpdates keeps its Latin canonical title.
CREATE OR REPLACE FUNCTION favlib_display_title(target_media_id text, target_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE selected media_title%ROWTYPE;
  reference_title text;
  shown text;
  matched boolean := false;
BEGIN
  SELECT favlib_clean_display_title(t.text) INTO reference_title
  FROM media_title t
  WHERE t.media_id=target_media_id AND t.kind='source'
  ORDER BY t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;

  WITH refs AS (
    SELECT DISTINCT lower(regexp_replace(favlib_clean_display_title(t.text),'[^[:alnum:]]+',' ','g')) AS key
    FROM media_title t
    WHERE t.media_id=target_media_id
      AND (t.kind='source' OR (t.kind='personal' AND (target_user_id IS NULL OR t.provenance->>'userId'=target_user_id::text)))
      AND favlib_clean_display_title(t.text) IS NOT NULL
  )
  SELECT t.* INTO selected
  FROM media_title t
  WHERE t.media_id=target_media_id
    AND t.kind<>'personal'
    AND t.connector IN ('anilist','mangaupdates')
    AND favlib_clean_display_title(t.text) IS NOT NULL
    AND t.text !~ '[ぁ-ゟァ-ヿ一-鿿々〆〄]'
  ORDER BY (t.title_type='romaji') DESC,
    (SELECT COALESCE(max(CASE
      WHEN lower(regexp_replace(favlib_clean_display_title(t.text),'[^[:alnum:]]+',' ','g'))=refs.key THEN 100
      WHEN lower(regexp_replace(favlib_clean_display_title(t.text),'[^[:alnum:]]+',' ','g')) LIKE '%'||refs.key||'%'
        OR refs.key LIKE '%'||lower(regexp_replace(favlib_clean_display_title(t.text),'[^[:alnum:]]+',' ','g'))||'%' THEN 80
      ELSE 0 END),0) FROM refs) DESC,
    (t.script='Latn') DESC,(t.title_type='english') DESC,
    (t.title_type='canonical') DESC,(t.kind='official') DESC,
    (t.connector='anilist') DESC,t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;

  IF selected.id IS NOT NULL THEN
    WITH refs AS (
      SELECT DISTINCT lower(regexp_replace(favlib_clean_display_title(t.text),'[^[:alnum:]]+',' ','g')) AS key
      FROM media_title t
      WHERE t.media_id=target_media_id
        AND (t.kind='source' OR (t.kind='personal' AND (target_user_id IS NULL OR t.provenance->>'userId'=target_user_id::text)))
        AND favlib_clean_display_title(t.text) IS NOT NULL
    )
    SELECT EXISTS(SELECT 1 FROM refs WHERE
      lower(regexp_replace(favlib_clean_display_title(selected.text),'[^[:alnum:]]+',' ','g'))=refs.key
      OR lower(regexp_replace(favlib_clean_display_title(selected.text),'[^[:alnum:]]+',' ','g')) LIKE '%'||refs.key||'%'
      OR refs.key LIKE '%'||lower(regexp_replace(favlib_clean_display_title(selected.text),'[^[:alnum:]]+',' ','g'))||'%') INTO matched;
    shown:=favlib_clean_display_title(selected.text);
    RETURN jsonb_build_object('title',shown,'referenceTitle',reference_title,'score',CASE WHEN matched THEN 1 ELSE .8 END,
      'alias',jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,'connector',selected.connector),
      'reason',CASE WHEN selected.title_type='romaji' THEN 'ROMAJI_FALLBACK' WHEN matched THEN 'PROVIDER_MATCHED_TITLE' ELSE 'PROVIDER_CANONICAL' END);
  END IF;
  RETURN jsonb_build_object('title',NULL,'referenceTitle',reference_title,'score',0,'alias',NULL,'reason','NO_TITLE');
END $$;
