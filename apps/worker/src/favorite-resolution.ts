type Query = (sql: string, values?: unknown[]) => Promise<unknown>;

export async function markFavoriteUnresolved(query: Query, mediaId: string, reason: string) {
  await query("UPDATE bookmark_media_link SET status='review',evidence=evidence||$2::jsonb WHERE media_id=$1 AND status IN ('matched','accepted','review')", [mediaId, JSON.stringify({ resolution: 'unresolved', reason })]);
  await query(`INSERT INTO personal_notification(user_id,release_key,kind,payload)
    SELECT l.user_id,$1,'FAVORITE_UNRESOLVED',jsonb_build_object('mediaId',$2,'title',COALESCE(
      (SELECT t.text FROM media_title t WHERE t.media_id=l.media_id AND t.kind='source' ORDER BY CASE WHEN t.title_type='official' THEN 0 ELSE 1 END,t.id LIMIT 1),l.media_id),
      'reason',$3,'message','Ce favori n’a pas pu être résolu auprès du fournisseur.')
    FROM bookmark_media_link l WHERE l.media_id=$2 AND l.status='review'
    ON CONFLICT(user_id,release_key,kind) DO NOTHING`, [`favorite-unresolved|${mediaId}`, mediaId, reason]);
}

export async function markFavoriteMatched(query: Query, mediaId: string) {
  await query("UPDATE bookmark_media_link SET status='matched',evidence=evidence||jsonb_build_object('resolution','active-provider') WHERE media_id=$1 AND status IN ('review','matched','accepted') AND EXISTS(SELECT 1 FROM media_metadata mm WHERE mm.media_id=$1 AND mm.status='ACTIVE' AND mm.provider IN ('anilist','mangaupdates'))", [mediaId]);
}
