-- A resolved user review is the durable identity authority for its bookmark.
-- Normal inventory/enrichment writes may still refresh evidence, but cannot
-- move the link or return it to review. Explicit removal remains possible.
CREATE OR REPLACE FUNCTION favlib_protect_resolved_favorite_link()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('favlib.resolved_review_repair', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1 FROM favorite_review r
    WHERE r.user_id=OLD.user_id
      AND r.installation_id=OLD.installation_id
      AND r.bookmark_id=OLD.bookmark_id
      AND r.status='RESOLVED'
      AND r.decision IS NOT NULL
  ) AND NEW.status <> 'removed'
    AND (NEW.media_id IS DISTINCT FROM OLD.media_id OR NEW.status IS DISTINCT FROM OLD.status)
  THEN
    RAISE EXCEPTION 'RESOLVED_FAVORITE_LINK_IMMUTABLE'
      USING ERRCODE='integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookmark_media_link_resolved_review_immutable ON bookmark_media_link;
CREATE TRIGGER bookmark_media_link_resolved_review_immutable
BEFORE UPDATE OF media_id,status ON bookmark_media_link
FOR EACH ROW EXECUTE FUNCTION favlib_protect_resolved_favorite_link();
