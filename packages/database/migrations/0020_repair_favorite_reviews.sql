-- Rehydrate review candidates from durable enrichment observations only. This
-- never changes status, selected_candidate_id, decision, or bookmark links.
WITH latest AS (
  SELECT DISTINCT ON (media_id) media_id, provider, candidate_snapshot, error_code
  FROM media_enrichment_state
  WHERE purpose='metadata' AND provider IN ('anilist','mangaupdates')
  ORDER BY media_id, updated_at DESC
), review_media AS (
  SELECT r.id AS review_id, r.user_id, r.installation_id, r.bookmark_id,
         l.media_id, latest.provider, latest.candidate_snapshot, latest.error_code
  FROM favorite_review r
  JOIN bookmark_media_link l ON l.user_id=r.user_id
    AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id
  JOIN latest ON latest.media_id=l.media_id
  WHERE NOT EXISTS (SELECT 1 FROM favorite_review_candidate c WHERE c.review_id=r.id)
)
INSERT INTO favorite_review_candidate
  (review_id, provider_id, canonical_title, hit_title, associated_titles, type,
   year, start_date, status, authors, categories, genres, image, url, payload, media_id)
SELECT review_id,
       COALESCE(candidate->>'id', candidate->>'providerId'),
       COALESCE(NULLIF(candidate->>'title',''), NULLIF(candidate->>'canonicalTitle',''), provider || ' candidate'),
       candidate->>'hitTitle',
       CASE WHEN jsonb_typeof(candidate->'titles')='array'
            THEN ARRAY(SELECT jsonb_array_elements_text(candidate->'titles')) ELSE NULL END,
       candidate->>'type',
       NULLIF(candidate->>'year','')::int,
       candidate->'startDate', candidate->>'status',
       candidate->'authors',
       CASE WHEN jsonb_typeof(candidate->'categories')='array'
            THEN ARRAY(SELECT jsonb_array_elements_text(candidate->'categories')) ELSE NULL END,
       CASE WHEN jsonb_typeof(candidate->'genres')='array'
            THEN ARRAY(SELECT jsonb_array_elements_text(candidate->'genres')) ELSE NULL END,
       COALESCE(candidate->>'image', candidate->'coverImage'),
       COALESCE(candidate->>'url', candidate->>'siteUrl',
         CASE WHEN provider='anilist' THEN 'https://anilist.co' ELSE 'https://www.mangaupdates.com' END),
       candidate, media_id
FROM review_media
CROSS JOIN LATERAL jsonb_array_elements(
  CASE WHEN jsonb_typeof(candidate_snapshot)='array' THEN candidate_snapshot ELSE '[]'::jsonb END
) candidate
WHERE COALESCE(candidate->>'id', candidate->>'providerId') IS NOT NULL
ON CONFLICT (review_id, provider_id) DO NOTHING;

UPDATE favorite_review r
SET reason = CASE
  WHEN EXISTS (SELECT 1 FROM favorite_review_candidate c WHERE c.review_id=r.id)
    THEN COALESCE(r.reason, 'LOW_CONFIDENCE')
  ELSE COALESCE(r.reason, 'NO_RESULT')
END
WHERE r.reason IS NULL;
