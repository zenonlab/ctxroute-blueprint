-- Recover AniList image identity only from durable local evidence. This is a
-- metadata-only backfill: it performs no network request and changes no asset.
UPDATE media_cover c SET provider_external_id=COALESCE(
  (SELECT e.external_id FROM media_external_id e WHERE e.media_id=c.media_id AND e.provider='anilist' ORDER BY e.id LIMIT 1),
  (regexp_match(c.media_id,'^anilist:([0-9]+)$'))[1],
  (regexp_match(c.source_url,'/(?:b|n)x?([0-9]+)-'))[1]
)
WHERE c.provider='anilist' AND c.provider_external_id IS NULL;

UPDATE media_banner b SET provider_external_id=COALESCE(
  (SELECT e.external_id FROM media_external_id e WHERE e.media_id=b.media_id AND e.provider='anilist' ORDER BY e.id LIMIT 1),
  (regexp_match(b.media_id,'^anilist:([0-9]+)$'))[1],
  (regexp_match(b.source_url,'/(?:b|n)x?([0-9]+)-'))[1]
)
WHERE b.provider='anilist' AND b.provider_external_id IS NULL;

UPDATE media_cover SET provenance=jsonb_set(provenance,'{externalId}',to_jsonb(provider_external_id),true)
WHERE provider='anilist' AND provider_external_id IS NOT NULL AND provenance->>'externalId' IS NULL;
UPDATE media_banner SET provenance=jsonb_set(provenance,'{externalId}',to_jsonb(provider_external_id),true)
WHERE provider='anilist' AND provider_external_id IS NOT NULL AND provenance->>'externalId' IS NULL;
