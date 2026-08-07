-- Canonical provider rows retain canonical provenance even when their Latin
-- script was inferred from text rather than explicitly stored.
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
