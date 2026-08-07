-- Display the current user's personal favorite alias directly.
-- Provider and parser aliases remain in media_title for search and metadata.
CREATE OR REPLACE FUNCTION favlib_display_title(target_media_id text, target_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  reference_title text;
  selected media_title%ROWTYPE;
  reason text;
BEGIN
  -- The parser's URL title is the stable reference shown in the projection.
  -- Page metadata is retained as a compatibility fallback for older rows.
  SELECT t.text INTO reference_title
  FROM media_title t
  WHERE t.media_id=target_media_id
    AND t.kind='source' AND t.connector='source-url'
  ORDER BY t.confidence DESC NULLS LAST,t.id DESC
  LIMIT 1;

  -- A personal alias belongs to a user, so it must win without comparing it
  -- to parser or provider titles. Never select another user's personal alias.
  IF target_user_id IS NOT NULL THEN
    SELECT t.* INTO selected
    FROM media_title t
    WHERE t.media_id=target_media_id
      AND t.kind='personal'
      AND t.provenance->>'userId'=target_user_id::text
    ORDER BY t.id DESC
    LIMIT 1;
    IF selected.id IS NOT NULL THEN
      RETURN jsonb_build_object('title',selected.text,'referenceTitle',reference_title,'score',1,
        'alias',jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,
          'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,
          'connector',selected.connector),'reason','PERSONAL_ALIAS');
    END IF;
  END IF;

  -- Without a personal alias, use only an existing Latin/romaji provider alias.
  SELECT t.* INTO selected
  FROM media_title t
  WHERE t.media_id=target_media_id AND t.kind<>'personal'
    AND t.connector IN ('anilist','mangaupdates')
    AND (t.title_type='romaji' OR t.script='Latn'
      OR (t.script IS NULL AND t.text !~ '[ぁ-ゟァ-ヿ一-鿿]'))
  ORDER BY (t.title_type='romaji') DESC,(t.script='Latn') DESC,
    CASE t.connector WHEN 'anilist' THEN 0 ELSE 1 END,t.id DESC
  LIMIT 1;
  IF selected.id IS NULL THEN
    RETURN jsonb_build_object('title',NULL,'referenceTitle',reference_title,'score',0,'alias',NULL,'reason','NO_TITLE');
  END IF;
  reason := 'ROMAJI_FALLBACK';
  RETURN jsonb_build_object('title',selected.text,'referenceTitle',reference_title,'score',0,
    'alias',jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,
      'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,
      'connector',selected.connector),'reason',reason);
END $$;
