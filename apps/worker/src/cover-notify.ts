type Query = (sql: string, values?: unknown[]) => Promise<unknown>;

export async function notifyCoverUnavailable(
  query: Query,
  mediaId: string,
  reason: string,
) {
  await query(
    `INSERT INTO personal_notification(user_id,release_key,kind,payload)
     SELECT l.user_id,$1::text,'COVER_UNAVAILABLE',jsonb_build_object(
       'mediaId',$2::text,'title',COALESCE(
         (SELECT t.text FROM media_title t WHERE t.media_id=m.id AND t.kind='source'
          ORDER BY CASE WHEN t.connector='source-url' THEN 0 ELSE 1 END,t.id LIMIT 1),
         (SELECT t.text FROM media_title t WHERE t.media_id=m.id AND t.kind='official'
          ORDER BY t.id LIMIT 1),m.id),
       'reason',$3,'message','Aucune couverture disponible pour ce favori'
     )
     FROM bookmark_media_link l
     JOIN media m ON m.id=l.media_id
     WHERE l.media_id=$2::text AND l.status IN ('matched','accepted')
     ON CONFLICT(user_id,release_key,kind) DO NOTHING`,
    [`${mediaId}|cover-unavailable`, mediaId, reason],
  );
}
