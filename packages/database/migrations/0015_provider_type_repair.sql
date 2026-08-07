-- MangaUpdates already stores the selected candidate snapshot locally. Use it
-- to repair MANGA/MANHWA/MANHUA labels without contacting the provider.
UPDATE media m
SET type = CASE candidate->>'type'
  WHEN 'Manhwa' THEN 'MANHWA'
  WHEN 'Manhua' THEN 'MANHUA'
  WHEN 'Manga' THEN 'MANGA'
  ELSE m.type
END,
updated_at = now()
FROM media_external_id e
JOIN media_enrichment_state s ON s.media_id=e.media_id
CROSS JOIN LATERAL jsonb_array_elements(s.candidate_snapshot) candidate
WHERE e.media_id=m.id
  AND e.provider='mangaupdates'
  AND s.provider='mangaupdates'
  AND s.purpose='metadata'
  AND s.status='SUCCESS'
  AND candidate->>'id'=e.external_id
  AND candidate->>'type' IN ('Manga','Manhwa','Manhua')
  AND m.type IN ('MANGA','MANHWA','MANHUA');
