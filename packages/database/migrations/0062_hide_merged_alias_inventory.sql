-- Identity merges remain durable audit records, but their technical relation
-- must have exactly one current target and must never act as catalog discovery.
DELETE FROM media_relation relation
USING media_identity_merge merge
WHERE relation.media_id=merge.source_media_id
  AND relation.kind='canonical_variant'
  AND relation.target_media_id<>merge.target_media_id;

INSERT INTO media_relation(media_id,target_media_id,kind,provenance)
SELECT source_media_id,target_media_id,'canonical_variant',evidence
FROM media_identity_merge
ON CONFLICT(media_id,target_media_id,kind) DO UPDATE
SET provenance=excluded.provenance;

CREATE OR REPLACE FUNCTION merge_media_identity(source_id text,target_id text,merge_provider text,merge_external_id text,merge_evidence jsonb)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF source_id=target_id THEN RETURN; END IF;
  INSERT INTO media_identity_merge(source_media_id,target_media_id,provider,external_id,evidence)
  VALUES(source_id,target_id,merge_provider,merge_external_id,merge_evidence)
  ON CONFLICT(source_media_id) DO UPDATE SET target_media_id=excluded.target_media_id,provider=excluded.provider,external_id=excluded.external_id,evidence=excluded.evidence,merged_at=now();
  DELETE FROM media_relation
  WHERE media_id=source_id AND kind='canonical_variant' AND target_media_id<>target_id;
  INSERT INTO media_relation(media_id,target_media_id,kind,provenance)
  VALUES(source_id,target_id,'canonical_variant',merge_evidence)
  ON CONFLICT(media_id,target_media_id,kind) DO UPDATE SET provenance=excluded.provenance;
  INSERT INTO media_title(media_id,text,normalized_text,language,kind,connector,provenance)
    SELECT target_id,text,normalized_text,language,kind,connector,provenance FROM media_title WHERE media_id=source_id ON CONFLICT DO NOTHING;
  INSERT INTO metadata_assertion(media_id,field,value,provider,source_url,confidence,asserted_at,attribution)
    SELECT target_id,field,value,provider,source_url,confidence,asserted_at,attribution FROM metadata_assertion WHERE media_id=source_id ON CONFLICT DO NOTHING;
  UPDATE media_external_id SET media_id=target_id WHERE media_id=source_id;
  INSERT INTO media_cover(media_id,source_url,provider,attribution,mime_type,data,width,height,byte_size,status,fetched_at,error)
    SELECT target_id,source_url,provider,attribution,mime_type,data,width,height,byte_size,status,fetched_at,error FROM media_cover WHERE media_id=source_id ON CONFLICT(media_id) DO NOTHING;
  UPDATE bookmark_media_link SET media_id=target_id WHERE media_id=source_id;
  DELETE FROM favorite_progress s USING favorite_progress t WHERE s.media_id=source_id AND t.media_id=target_id AND s.user_id=t.user_id AND s.position_kind=t.position_kind;
  UPDATE favorite_progress SET media_id=target_id WHERE media_id=source_id;
  UPDATE release_announcement SET media_id=target_id WHERE media_id=source_id;
  UPDATE release_origin SET media_id=target_id WHERE media_id=source_id;
END $$;

-- A removed raw bookmark cannot continue contributing a visible personal
-- link. The import, review and merge provenance remain stored for audit.
UPDATE bookmark_media_link link
SET status='removed'
FROM bookmark_import_item item
WHERE item.user_id=link.user_id
  AND item.installation_id=link.installation_id
  AND item.bookmark_id=link.bookmark_id
  AND item.event='removed'
  AND link.status IN ('matched','accepted','review');
