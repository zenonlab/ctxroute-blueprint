type Query = (sql: string, values?: unknown[]) => Promise<unknown>;

export async function notifyCoverUnavailable(
  query: Query,
  mediaId: string,
  reason: string,
) {
  await query(
    `INSERT INTO personal_notification(user_id,release_key,kind,payload)
     SELECT l.user_id,$1,'COVER_UNAVAILABLE',jsonb_build_object(
       'mediaId',$2,'title',COALESCE(i.payload->>'title',m.id),
       'reason',$3,'message','Aucune couverture disponible pour ce favori'
     )
     FROM bookmark_media_link l
     JOIN media m ON m.id=l.media_id
     LEFT JOIN bookmark_import_item i ON i.user_id=l.user_id
       AND i.installation_id=l.installation_id AND i.bookmark_id=l.bookmark_id
     WHERE l.media_id=$2 AND l.status IN ('matched','accepted')
     ON CONFLICT(user_id,release_key,kind) DO NOTHING`,
    [`${mediaId}|cover-unavailable`, mediaId, reason],
  );
}
