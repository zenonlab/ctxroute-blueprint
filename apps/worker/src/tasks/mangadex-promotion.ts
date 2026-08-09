import type { Task } from 'graphile-worker';
import { parseMangaDexManga } from '@favlib/metadata';

const recordNextAttempt = (h: Parameters<Task>[1], mediaId: string, error: string | null) => h.query(
  "UPDATE mangadex_promotion_state SET last_attempt_at=now(),last_error=$2,next_attempt_at=favlib_next_paris_monday(now()+interval '1 minute'),updated_at=now() WHERE media_id=$1 AND status='PENDING'",
  [mediaId,error],
);

/** Weekly, idempotent dispatcher for the MangaDex links.mu bridge.
 *
 * It deliberately writes no MangaUpdates identity or metadata. The canonical
 * enrichment task reuses the stored raw MangaDex payload, resolves links.mu,
 * verifies the shared symmetric title matcher, fetches the complete
 * MangaUpdates record and only then marks the promotion complete. This keeps
 * one persistence pipeline for status, chapter, volume, authors and raw
 * provenance.
 */
const task: Task = async (_payload, h) => {
  const due = await h.query(`SELECT s.media_id,s.mangadex_id,p.payload
    FROM mangadex_promotion_state s
    JOIN media_metadata mm ON mm.media_id=s.media_id AND mm.provider='mangadex' AND mm.status='ACTIVE'
    LEFT JOIN LATERAL (
      SELECT payload FROM provider_payload
      WHERE media_id=s.media_id AND provider='mangadex' AND validity_status='VALID' AND is_current=true
      ORDER BY collected_at DESC LIMIT 1
    ) p ON true
    WHERE s.status='PENDING' AND s.next_attempt_at<=now()
    ORDER BY s.next_attempt_at,s.media_id LIMIT 100 FOR UPDATE OF s SKIP LOCKED`);
  for (const row of due.rows as Array<{media_id:string;mangadex_id:string;payload:unknown}>) {
    const mangaDex = parseMangaDexManga(row.payload);
    if (!mangaDex?.mangaUpdatesId) {
      await recordNextAttempt(h,row.media_id,'MANGADEX_MU_LINK_MISSING');
      continue;
    }
    await h.query(
      "SELECT graphile_worker.add_job('mangaupdates-enrichment',$1,job_key := $2,max_attempts := 3,priority := -10,job_key_mode := 'replace')",
      [JSON.stringify({mediaId:row.media_id,forceRefresh:true,bridgeSource:'mangadex-links.mu'}),`mangadex-mangaupdates-promotion:${row.media_id}`],
    );
    await recordNextAttempt(h,row.media_id,null);
  }
};
export default task;
