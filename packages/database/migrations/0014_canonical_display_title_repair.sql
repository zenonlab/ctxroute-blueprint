-- Canonical title repair. This migration is strictly local: it only uses
-- media_title/provider_payload rows already present and never schedules a
-- provider request or touches covers, banners, links, or identities.

CREATE OR REPLACE FUNCTION favlib_clean_display_title(value text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  current text := trim(regexp_replace(coalesce(value,''),'\s+',' ','g'));
  before text;
  part text;
  parts text[];
  kept text[] := ARRAY[]::text[];
  key text;
  seen text[] := ARRAY[]::text[];
BEGIN
  IF current = '' THEN RETURN NULL; END IF;
  FOR i IN 1..6 LOOP
    before := current;
    current := regexp_replace(current,
      '(?:^|\s*(?:[-–—|·:]\s*))(?:(?:episode|ep\.?|chapter|chapitre|chap\.?|ch\.?|volume|vol\.?|season|saison)\s*#?[0-9][[:alnum:].-]*|[0-9]+\s*(?:vostfr|vf|vo|sub|dub|scan|scans)?|(?:vostfr|vf|vo|sub|dub|scan|scans)\s*[- ]?[0-9]*).*$', '', 'i');
    current := regexp_replace(current,
      '(?:^|\s*(?:[-–—|·:]\s*))voiranime|mangakakalot|anime[- ]?sama|japscan|lelscan|manganato|mangadex.*$', '', 'i');
    current := trim(regexp_replace(current,'[|·:—–-]+$','','g'));
    EXIT WHEN current = before;
  END LOOP;
  parts := regexp_split_to_array(current,'\s*(?:\||·|—|–)\s*|\s+-\s+');
  FOREACH part IN ARRAY parts LOOP
    part := trim(part);
    IF part = '' THEN CONTINUE; END IF;
    key := lower(regexp_replace(part,'[^[:alnum:]]','','g'));
    IF key = ANY(seen) THEN CONTINUE; END IF;
    seen := array_append(seen,key);
    kept := array_append(kept,part);
  END LOOP;
  current := trim(array_to_string(kept,' - '));
  IF current = '' OR current ~* '^(episode|chapter|volume|vostfr|vf|scan)\b' THEN RETURN NULL; END IF;
  RETURN current;
END $$;

-- Normalize existing provider canonical rows in place, preserving their IDs
-- and provenance. If an older run only stored an official/supplier title,
-- promote the best local provider title to a canonical row.
UPDATE media_title
SET text=favlib_clean_display_title(text),
    normalized_text=lower(regexp_replace(favlib_clean_display_title(text),'[^[:alnum:]]+',' ','g'))
WHERE connector IN ('anilist','mangaupdates')
  AND title_type='canonical'
  AND favlib_clean_display_title(text) IS NOT NULL;

WITH candidates AS (
  SELECT DISTINCT ON (t.media_id,t.connector)
    t.media_id,t.connector,t.text,t.language,t.script,t.confidence,
    t.provenance, favlib_clean_display_title(t.text) AS cleaned
  FROM media_title t
  WHERE t.connector IN ('anilist','mangaupdates')
    AND t.title_type IN ('official','associated')
    AND favlib_clean_display_title(t.text) IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM media_title c
      WHERE c.media_id=t.media_id AND c.connector=t.connector
        AND c.kind='official' AND c.title_type='canonical'
    )
  ORDER BY t.media_id,t.connector,
    (t.kind='official') DESC,(t.title_type='official') DESC,
    t.confidence DESC NULLS LAST,t.id
)
INSERT INTO media_title(media_id,text,normalized_text,language,script,kind,title_type,personal_status,connector,confidence,provenance)
SELECT media_id,cleaned,lower(regexp_replace(cleaned,'[^[:alnum:]]+',' ','g')),language,script,
  'official','canonical',NULL,connector,COALESCE(confidence,1),
  provenance || jsonb_build_object('canonical',true,'repairedLocally',true)
FROM candidates
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION favlib_display_title(target_media_id text, target_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE selected media_title%ROWTYPE; reference_title text; shown text;
BEGIN
  SELECT favlib_clean_display_title(t.text) INTO reference_title
  FROM media_title t WHERE t.media_id=target_media_id AND t.kind='source'
  ORDER BY t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;

  -- Provider canonical > provider official > cleaned source > cleaned
  -- personal. Personal aliases are never user-specific display overrides.
  SELECT t.* INTO selected FROM media_title t
  WHERE t.media_id=target_media_id AND t.kind='official'
    AND t.connector IN ('anilist','mangaupdates')
    AND t.title_type='canonical' AND favlib_clean_display_title(t.text) IS NOT NULL
  ORDER BY CASE t.connector WHEN 'anilist' THEN 0 ELSE 1 END,t.id DESC LIMIT 1;
  IF selected.id IS NULL THEN
    SELECT t.* INTO selected FROM media_title t
    WHERE t.media_id=target_media_id AND t.kind IN ('official','supplier')
      AND t.connector IN ('anilist','mangaupdates')
      AND favlib_clean_display_title(t.text) IS NOT NULL
    ORDER BY (t.kind='official') DESC,(t.title_type='official') DESC,
      CASE t.connector WHEN 'anilist' THEN 0 ELSE 1 END,t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;
  END IF;
  IF selected.id IS NULL THEN
    SELECT t.* INTO selected FROM media_title t
    WHERE t.media_id=target_media_id AND t.kind='source'
      AND favlib_clean_display_title(t.text) IS NOT NULL
    ORDER BY t.confidence DESC NULLS LAST,t.id DESC LIMIT 1;
  END IF;
  IF selected.id IS NULL AND target_user_id IS NOT NULL THEN
    SELECT t.* INTO selected FROM media_title t
    WHERE t.media_id=target_media_id AND t.kind='personal'
      AND t.provenance->>'userId'=target_user_id::text
      AND favlib_clean_display_title(t.text) IS NOT NULL
    ORDER BY t.id DESC LIMIT 1;
  END IF;
  IF selected.id IS NULL THEN
    RETURN jsonb_build_object('title',NULL,'referenceTitle',reference_title,'score',0,'alias',NULL,'reason','NO_TITLE');
  END IF;
  shown:=favlib_clean_display_title(selected.text);
  RETURN jsonb_build_object('title',shown,'referenceTitle',reference_title,'score',CASE WHEN selected.id IS NULL THEN 0 WHEN selected.connector IN ('anilist','mangaupdates') THEN 1 ELSE .5 END,
    'alias',jsonb_build_object('id',selected.id,'text',selected.text,'language',selected.language,'script',selected.script,'kind',selected.kind,'titleType',selected.title_type,'connector',selected.connector),'reason',
    CASE WHEN selected.connector IN ('anilist','mangaupdates') THEN 'PROVIDER_CANONICAL' WHEN selected.kind='source' THEN 'SOURCE_CLEAN' ELSE 'PERSONAL_CLEAN' END);
END $$;
