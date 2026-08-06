-- Matching semantics v11/v9: repair parser-derived aliases only. Personal and
-- raw bookmark titles are intentionally excluded.
UPDATE media_title
SET text = initcap(replace(regexp_replace(text, '^\s*[0-9]+[-_ ]+', ''), '-', ' ')),
    normalized_text = lower(regexp_replace(regexp_replace(text, '^\s*[0-9]+[-_ ]+', ''), '[^[:alnum:]]+', ' ', 'g')),
    provenance = provenance || '{"repair":"comick-numeric-prefix-v1"}'::jsonb
WHERE kind='source' AND connector='source-url'
  AND provenance->>'sourceUrl' ~* '^https?://(www\.)?comick\.(dev|io|to)/comic/[0-9]+-';

-- Automatic decisions that violate the new editorial-format rules are reset.
-- A resolved review is an immutable user decision and therefore excludes the row.
CREATE TEMP TABLE favlib_invalid_automatic_identity ON COMMIT DROP AS
SELECT DISTINCT mm.media_id,mm.provider,mm.external_id,
  CASE
    WHEN EXISTS (SELECT 1 FROM media_title pt WHERE pt.media_id=mm.media_id AND pt.connector=mm.provider AND pt.text ~* '\mPre[ -]*seriali[sz](ation|ed)\M')
      AND NOT EXISTS (SELECT 1 FROM media_title st WHERE st.media_id=mm.media_id AND st.kind='source' AND (st.text ~* '\mPre[ -]*seriali[sz](ation|ed)\M' OR st.provenance->>'sourceUrl' ~* 'pre[ -]*seriali[sz](ation|ed)'))
      THEN 'PRE_SERIALIZATION_SOURCE_EVIDENCE_MISSING'
    WHEN mm.provider='anilist' AND m.format='OVA'
      AND NOT EXISTS (SELECT 1 FROM media_title st WHERE st.media_id=mm.media_id AND st.kind='source' AND (st.text ~* '(^|[^[:alnum:]])OVA([^[:alnum:]]|$)' OR st.provenance->>'sourceUrl' ~* '(^|[^[:alnum:]])OVA([^[:alnum:]]|$)'))
      THEN 'OVA_SOURCE_EVIDENCE_MISSING'
  END AS reason
FROM media_metadata mm JOIN media m ON m.id=mm.media_id
WHERE mm.status='ACTIVE' AND mm.provider IN ('anilist','mangaupdates')
  AND NOT EXISTS (
    SELECT 1 FROM favorite_review r JOIN favorite_review_candidate c ON c.id=r.selected_candidate_id
    WHERE r.status='RESOLVED' AND r.decision IS NOT NULL AND r.provider=mm.provider AND c.provider_id=mm.external_id
  );
DELETE FROM favlib_invalid_automatic_identity WHERE reason IS NULL;

INSERT INTO admin_audit_event(action,target_type,target_id,summary)
SELECT 'provider_identity.automatic_repair','media',media_id,
  jsonb_build_object('provider',provider,'externalId',external_id,'reason',reason)
FROM favlib_invalid_automatic_identity;

UPDATE bookmark_media_link l SET status='review',evidence=l.evidence || jsonb_build_object('resolution','backfill-invalidated')
WHERE EXISTS (SELECT 1 FROM favlib_invalid_automatic_identity x WHERE x.media_id=l.media_id)
  AND l.status IN ('matched','accepted','review');
DELETE FROM media_metadata mm USING favlib_invalid_automatic_identity x
WHERE mm.media_id=x.media_id AND mm.provider=x.provider AND mm.external_id=x.external_id;
DELETE FROM media_external_id e USING favlib_invalid_automatic_identity x
WHERE e.media_id=x.media_id AND e.provider=x.provider AND e.external_id=x.external_id;

-- Pending reviews are replaceable on the next valid parse; resolved reviews stay intact.
DELETE FROM favorite_review_candidate c USING favorite_review r,bookmark_media_link l
WHERE c.review_id=r.id AND r.status='PENDING' AND r.decision IS NULL
  AND l.user_id=r.user_id AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id
  AND EXISTS (SELECT 1 FROM media_title t WHERE t.media_id=l.media_id AND t.kind='source' AND t.provenance->>'repair'='comick-numeric-prefix-v1');

UPDATE media_enrichment_state SET invalidated_at=now(),next_attempt_at=NULL,updated_at=now()
WHERE purpose='metadata' AND provider IN ('anilist','mangaupdates')
  AND connector_version IN ('anilist-v10','mangaupdates-v8');

CREATE INDEX IF NOT EXISTS media_enrichment_cover_due_idx
  ON media_enrichment_state(provider,status,next_attempt_at,attempt_count,media_id)
  WHERE purpose='cover' AND status IN ('PENDING','FAILED','NO_MATCH');
CREATE INDEX IF NOT EXISTS media_cover_missing_state_idx
  ON media_cover(status,media_id) WHERE status<>'ACTIVE';
