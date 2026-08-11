import { Client } from 'pg';
import { runtimeEnvironment } from '@favlib/config';
import { collectiveTitleKey, prepareTitleCandidates, type MediaType } from '@favlib/metadata';

const databaseUrl=runtimeEnvironment().databaseUrl;
const client=new Client({connectionString:databaseUrl});
await client.connect();
try{
  await client.query('BEGIN');
  const reviews=await client.query(`SELECT r.id,r.provider,r.favorite_title,r.favorite_url,
    COALESCE(NULLIF(i.payload->>'title',''),r.favorite_title) AS raw_title,
    COALESCE(c.type,'') AS candidate_type
    FROM favorite_review r LEFT JOIN bookmark_import_item i ON i.user_id=r.user_id AND i.installation_id=r.installation_id AND i.bookmark_id=r.bookmark_id
    LEFT JOIN favorite_review_candidate c ON c.id=r.selected_candidate_id WHERE r.cluster_id IS NULL FOR UPDATE OF r`);
  let clustered=0;
  for(const row of reviews.rows){
    const provider=row.provider as 'anilist'|'mangaupdates';
    const rawTitle=String(row.raw_title);
    const parsed=prepareTitleCandidates({bookmarkTitle:rawTitle,url:String(row.favorite_url)});
    const parsedTitle=parsed.personal??parsed.sourceTitle??String(row.favorite_title).trim();
    const reading=String(row.candidate_type).toUpperCase();
    const mediaType:MediaType=provider==='anilist'?'ANIME':reading==='MANHWA'||reading==='MANHUA'?reading:'MANGA';
    // No legacy column proves a season explicitly. In particular a trailing
    // number remains part of the parsed title and is never promoted here.
    const key=collectiveTitleKey({provider,mediaType,parsedTitle});
    const cluster=await client.query(`INSERT INTO review_title_cluster(cluster_key,provider,media_type,parsed_title,raw_title_sample)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT(cluster_key) DO UPDATE SET updated_at=now() RETURNING id`,[key,provider,mediaType,parsedTitle,rawTitle]);
    await client.query('UPDATE favorite_review SET cluster_id=$2 WHERE id=$1',[row.id,cluster.rows[0].id]);
    await client.query(`INSERT INTO review_cluster_candidate(cluster_id,profile_id)
      SELECT $2,profile_id FROM favorite_review_candidate WHERE review_id=$1 AND profile_id IS NOT NULL ON CONFLICT DO NOTHING`,[row.id,cluster.rows[0].id]);
    clustered++;
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({status:'ok',clustered,legacyVotesCreated:0}));
}catch(error){await client.query('ROLLBACK');throw error}finally{await client.end()}
