-- Repair only parser-derived aliases. Raw Chrome favorites (original=true) are
-- retained verbatim, including their release text and provenance.
DELETE FROM media_title
WHERE connector='source-url' AND title_type='alias'
  AND (
    btrim(text) ~ '^[[:digit:]]+([.,][[:digit:]]+)?$'
    OR lower(btrim(text)) ~ '^(episode|ep\.?|chapter|chapitre|chap\.?|ch\.?|volume|vol\.?|season|saison)[[:space:]._-]*[[:digit:]]+'
    OR lower(btrim(text)) ~ '^(vf|vostfr|vo|sub|dub|scan|scans)([[:space:]._-]*[[:digit:]]+)?$'
  );

DELETE FROM media_title
WHERE kind='personal' AND provenance->>'original'='false'
  AND provenance->>'role' IN ('cleaned-personal-title','url-or-cleaned-title-alias')
  AND (
    btrim(text) ~ '^[[:digit:]]+([.,][[:digit:]]+)?$'
    OR lower(btrim(text)) ~ '^(episode|ep\.?|chapter|chapitre|chap\.?|ch\.?|volume|vol\.?|season|saison)[[:space:]._-]*[[:digit:]]+'
    OR lower(btrim(text)) ~ '^(vf|vostfr|vo|sub|dub|scan|scans)([[:space:]._-]*[[:digit:]]+)?$'
  );

-- Prefer the closest readable Latin provider spelling. A non-Latin canonical
-- cannot hide a matching Latin alias; an empty cleaned value never competes.
CREATE OR REPLACE FUNCTION favlib_display_title(target_media_id text, target_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE selected media_title%ROWTYPE; reference_title text; shown text; match_score integer;
BEGIN
  SELECT favlib_clean_display_title(t.text) INTO reference_title
  FROM media_title t
  WHERE t.media_id=target_media_id AND t.kind='source'
    AND favlib_clean_display_title(t.text) IS NOT NULL
    AND btrim(favlib_clean_display_title(t.text))<>''
  ORDER BY (t.provenance->>'selectedSegment' IS NOT NULL) DESC,t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;

  WITH refs AS (
    SELECT DISTINCT lower(regexp_replace(favlib_clean_display_title(t.text),'[^[:alnum:]]+',' ','g')) key
    FROM media_title t
    WHERE t.media_id=target_media_id AND t.kind='source'
      AND favlib_clean_display_title(t.text) IS NOT NULL AND btrim(favlib_clean_display_title(t.text))<>''
  ), ranked AS (
    SELECT t.id,COALESCE(max(CASE
      WHEN lower(regexp_replace(favlib_clean_display_title(t.text),'[^[:alnum:]]+',' ','g'))=refs.key THEN 100
      WHEN lower(regexp_replace(favlib_clean_display_title(t.text),'[^[:alnum:]]+',' ','g')) LIKE '%'||refs.key||'%'
        OR refs.key LIKE '%'||lower(regexp_replace(favlib_clean_display_title(t.text),'[^[:alnum:]]+',' ','g'))||'%' THEN 70
      ELSE 0 END),0)::integer score
    FROM media_title t LEFT JOIN refs ON true
    WHERE t.media_id=target_media_id AND t.kind<>'personal'
      AND t.connector IN ('anilist','mangaupdates')
      AND favlib_clean_display_title(t.text) IS NOT NULL AND btrim(favlib_clean_display_title(t.text))<>''
      AND (t.script='Latn' OR t.text ~ '[A-Za-zÀ-ÖØ-öø-ÿ]')
    GROUP BY t.id
  )
  SELECT t.* INTO selected FROM ranked r JOIN media_title t ON t.id=r.id
  ORDER BY r.score DESC,(t.kind='translation' AND t.language='en') DESC,
    (t.title_type='romaji') DESC,(t.script='Latn') DESC,t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;

  IF selected.id IS NOT NULL THEN
    shown:=favlib_clean_display_title(selected.text);
    SELECT COALESCE(max(CASE WHEN lower(regexp_replace(shown,'[^[:alnum:]]+',' ','g'))=
      lower(regexp_replace(favlib_clean_display_title(t.text),'[^[:alnum:]]+',' ','g')) THEN 100 ELSE 0 END),0)
      INTO match_score FROM media_title t WHERE t.media_id=target_media_id AND t.kind='source';
    RETURN jsonb_build_object('title',shown,'referenceTitle',reference_title,'score',CASE WHEN match_score=100 THEN 1 ELSE .8 END,
      'alias',jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,'connector',selected.connector),
      'reason',CASE WHEN match_score=100 THEN 'PROVIDER_MATCHED_TITLE'
        WHEN selected.kind='translation' AND selected.language='en' THEN 'ENGLISH_FALLBACK'
        WHEN selected.title_type='romaji' THEN 'ROMAJI_FALLBACK'
        WHEN selected.title_type='canonical' THEN 'PROVIDER_CANONICAL'
        ELSE 'PROVIDER_LATIN_FALLBACK' END);
  END IF;
  RETURN jsonb_build_object('title',reference_title,'referenceTitle',reference_title,
    'score',CASE WHEN reference_title IS NULL THEN 0 ELSE 1 END,'alias',NULL,
    'reason',CASE WHEN reference_title IS NULL THEN 'NO_TITLE' ELSE 'SOURCE_CLEAN' END);
END $$;

SELECT graphile_worker.add_job(
  'reassess-favorite-reviews','{}'::json,
  job_key := 'review-reassess:provider-title-v6',max_attempts := 3,job_key_mode := 'replace'
);
