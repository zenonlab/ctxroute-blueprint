type Queryable = { query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }> };
export type AnimeSeasonLinkRepairProof = { id: string; userId: string; installationId: string; bookmarkId: string; rootMediaId: string; seasonMediaId: string };
export type AnimeSeasonLinkRepairPreview = { changes: AnimeSeasonLinkRepairProof[]; anomalies: Array<{ id: string; reason: string }> };
const candidatesSql = `WITH candidates AS (
  SELECT l.id,l.user_id AS "userId",l.installation_id AS "installationId",l.bookmark_id AS "bookmarkId",l.media_id AS "rootMediaId",NULLIF(l.evidence->>'animeSeasonMediaId','') AS "seasonMediaId"
  FROM bookmark_media_link l WHERE l.status IN ('matched','accepted','review') AND l.evidence->>'animeWorkRootId'=l.media_id AND NULLIF(l.evidence->>'animeSeasonMediaId','') IS NOT NULL AND l.evidence->>'animeSeasonMediaId'<>l.media_id
), classified AS (
  SELECT c.*,member.media_id IS NOT NULL AND member.status='PROVED' AS repairable,CASE WHEN member.media_id IS NULL THEN 'ANIME_SEASON_LINK_REPAIR_OUTSIDE_CHAIN' WHEN member.status<>'PROVED' THEN 'ANIME_SEASON_LINK_REPAIR_UNPROVED' ELSE NULL END AS reason
  FROM candidates c LEFT JOIN anime_work_member member ON member.root_media_id=c."rootMediaId" AND member.media_id=c."seasonMediaId"
) `;
export async function previewAnimeSeasonLinkRepair(query: Queryable['query']): Promise<AnimeSeasonLinkRepairPreview> {
  const [changes,anomalies]=await Promise.all([query(`${candidatesSql} SELECT id,"userId","installationId","bookmarkId","rootMediaId","seasonMediaId" FROM classified WHERE repairable ORDER BY id`),query(`${candidatesSql} SELECT id,reason FROM classified WHERE NOT repairable ORDER BY id`)]);
  return {changes:changes.rows,anomalies:anomalies.rows};
}
export async function applyAnimeSeasonLinkRepairBatch(query: Queryable['query'],limit:number):Promise<AnimeSeasonLinkRepairProof[]> {
  const result=await query(`${candidatesSql}, repairable AS (SELECT * FROM classified WHERE repairable ORDER BY id LIMIT $1) UPDATE bookmark_media_link l SET media_id=r."seasonMediaId",evidence=l.evidence||jsonb_build_object('animeSeasonLinkRepair',jsonb_build_object('kind','restore-proved-season-member','rootMediaId',r."rootMediaId",'seasonMediaId',r."seasonMediaId",'command','repair-anime-season-links')) FROM repairable r WHERE l.id=r.id RETURNING l.id,r."userId",r."installationId",r."bookmarkId",r."rootMediaId",r."seasonMediaId"`,[limit]);
  return result.rows;
}
export async function createAnimeSeasonLinkRepairReviews(query: Queryable['query']) { await query(`${candidatesSql} INSERT INTO favorite_review(user_id,installation_id,bookmark_id,favorite_title,favorite_url,provider,status,reason) SELECT c."userId"::uuid,c."installationId",c."bookmarkId",COALESCE(i.payload->>'title',''),COALESCE(i.payload->>'url',''),'anilist-chain','PENDING',c.reason FROM classified c LEFT JOIN bookmark_import_item i ON i.user_id=c."userId"::uuid AND i.installation_id=c."installationId" AND i.bookmark_id=c."bookmarkId" AND i.event<>'removed' WHERE NOT c.repairable ON CONFLICT(user_id,installation_id,bookmark_id,provider) DO UPDATE SET reason=excluded.reason WHERE favorite_review.status='PENDING'`); }
