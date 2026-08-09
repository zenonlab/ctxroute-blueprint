import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { Pool } from 'pg';
import { runtimeEnvironment } from '@favlib/config';
import { FAVORITE_IDENTITY_PARSER_VERSION, FAVORITE_PARSER_ID, FAVORITE_PROGRESS_PARSER_VERSION, collectiveTitleKey, parseFavorite, sourceIdentityFromUrl } from '@favlib/metadata';

const args=new Map(process.argv.slice(2).map(value=>{const [key,...rest]=value.split('=');return [key,rest.join('=')||'true']}));
const apply=args.has('--apply');
const proofPath=args.get('--proof')!;
const backupManifest=args.get('--backup-manifest');
if(!proofPath||!isAbsolute(proofPath))throw new Error('--proof=/absolute/path is required');
if(apply&&(!backupManifest||!isAbsolute(backupManifest)))throw new Error('--apply requires --backup-manifest=/absolute/path');

const hash=(value:unknown)=>createHash('sha256').update(typeof value==='string'||value instanceof Uint8Array?value:JSON.stringify(value)).digest('hex');
const pool=new Pool({connectionString:runtimeEnvironment().databaseUrl});

async function verifiedBackup(path:string){
  if(!path.endsWith('.json'))throw new Error('BACKUP_MANIFEST_MUST_BE_JSON');
  const manifest=JSON.parse(await readFile(path,'utf8'));
  if(manifest.restoreTest!=='VERIFIED'||!manifest.restoreTestAt)throw new Error('BACKUP_RESTORE_TEST_NOT_VERIFIED');
  const encrypted=path.replace(/\.json$/u,'.dump.age');
  const checksum=hash(await readFile(encrypted));
  if(checksum!==manifest.sha256)throw new Error('BACKUP_CHECKSUM_MISMATCH');
  return {manifestHash:hash(JSON.stringify(manifest)),createdAt:manifest.createdAt,restoreTestAt:manifest.restoreTestAt};
}

async function invariantSnapshot(client:any){
  const result=await client.query(`SELECT
    (SELECT md5(COALESCE(string_agg(user_id::text||':'||installation_id||':'||bookmark_id||':'||payload::text,'|' ORDER BY user_id,installation_id,bookmark_id),'')) FROM bookmark_import_item) AS imports,
    (SELECT md5(COALESCE(string_agg(provider||':'||external_id||':'||media_id,'|' ORDER BY provider,external_id),'')) FROM media_external_id) AS provider_ids`);
  return result.rows[0];
}

const progressionSignature=(value:any)=>value?{
  kind:value.kind,number:Number(value.number),raw:String(value.raw),season:value.season??null,
  localNumber:value.localNumber??null,globalNumber:value.globalNumber??null,
}:null;

async function rebuildMaterializedProgress(client:any,userId:string,mediaId:string,kind:string,invalidatedIds:string[]){
  if(!invalidatedIds.length)return 0;
  const current=await client.query(`SELECT observation_id AS "observationId" FROM favorite_progress WHERE user_id=$1 AND media_id=$2 AND position_kind=$3`,[userId,mediaId,kind]);
  if(!current.rows[0]||!invalidatedIds.includes(current.rows[0].observationId))return 0;
  const strongest=await client.query(`SELECT id,position_number,position_raw,season,local_position_number,global_position_number FROM progression_observation
    WHERE user_id=$1 AND media_id=$2 AND position_kind=$3 AND consented=true AND position_number IS NOT NULL
    ORDER BY COALESCE(global_position_number,position_number) DESC,observed_at DESC,id DESC LIMIT 1`,[userId,mediaId,kind]);
  if(strongest.rows[0])await client.query(`UPDATE favorite_progress SET position_number=$1,position_raw=$2,observation_id=$3,season=$4,local_position_number=$5,global_position_number=$6,updated_at=now()
    WHERE user_id=$7 AND media_id=$8 AND position_kind=$9`,[strongest.rows[0].position_number,strongest.rows[0].position_raw,strongest.rows[0].id,strongest.rows[0].season,strongest.rows[0].local_position_number,strongest.rows[0].global_position_number,userId,mediaId,kind]);
  else await client.query(`DELETE FROM favorite_progress WHERE user_id=$1 AND media_id=$2 AND position_kind=$3 AND observation_id=ANY($4::uuid[])`,[userId,mediaId,kind,invalidatedIds]);
  return 1;
}

async function main(){
  const client=await pool.connect();
  try{
    const stale=await client.query(`SELECT i.user_id AS "userId",i.installation_id AS "installationId",i.bookmark_id AS "bookmarkId",i.payload->>'title' AS title,i.payload->>'url' AS url,i.parser_version AS "parserVersion",i.parse_artifact AS "oldArtifact",i.progress_parser_version AS "progressParserVersion",
      (SELECT jsonb_build_object('kind',c.position_kind,'number',c.position_number,'raw',c.position_raw,'season',c.season,'localNumber',c.local_position_number,'globalNumber',c.global_position_number) FROM favorite_progress_candidate c WHERE c.user_id=i.user_id AND c.installation_id=i.installation_id AND c.bookmark_id=i.bookmark_id ORDER BY c.last_observed_at DESC LIMIT 1) AS "storedCandidate",
      (SELECT jsonb_build_object('kind',fp.position_kind,'number',fp.position_number,'raw',fp.position_raw,'season',fp.season,'localNumber',fp.local_position_number,'globalNumber',fp.global_position_number)
        FROM favorite_progress fp JOIN progression_observation o ON o.id=fp.observation_id
        WHERE o.user_id=i.user_id AND o.provenance->>'installationId'=i.installation_id AND o.provenance->>'bookmarkId'=i.bookmark_id
          AND fp.position_kind='chapter' AND fp.position_number BETWEEN 1900 AND EXTRACT(year FROM now())+1
          AND o.provenance->>'evidence'='numeric-url-segment-after-source-identity'
          AND fp.position_number IS DISTINCT FROM (i.parse_artifact#>>'{progression,number}')::numeric
        ORDER BY fp.updated_at DESC LIMIT 1) AS "materializedParserDrift",
      (SELECT fp.media_id FROM favorite_progress fp JOIN progression_observation o ON o.id=fp.observation_id
        WHERE o.user_id=i.user_id AND o.provenance->>'installationId'=i.installation_id AND o.provenance->>'bookmarkId'=i.bookmark_id
          AND fp.position_kind='chapter' AND fp.position_number BETWEEN 1900 AND EXTRACT(year FROM now())+1
          AND o.provenance->>'evidence'='numeric-url-segment-after-source-identity'
          AND fp.position_number IS DISTINCT FROM (i.parse_artifact#>>'{progression,number}')::numeric
        ORDER BY fp.updated_at DESC LIMIT 1) AS "materializedMediaId",
      l.media_id AS "mediaId",array_remove(array_agg(DISTINCT r.provider),NULL) AS providers
      FROM bookmark_import_item i LEFT JOIN bookmark_media_link l ON l.user_id=i.user_id AND l.installation_id=i.installation_id AND l.bookmark_id=i.bookmark_id AND l.status IN ('matched','accepted','review')
      LEFT JOIN favorite_review r ON r.user_id=i.user_id AND r.installation_id=i.installation_id AND r.bookmark_id=i.bookmark_id
      WHERE i.event<>'removed' AND (COALESCE(i.parser_version,0)<$1 OR COALESCE(i.progress_parser_version,0)<$2 OR EXISTS(SELECT 1 FROM favorite_progress_candidate c WHERE c.user_id=i.user_id AND c.installation_id=i.installation_id AND c.bookmark_id=i.bookmark_id AND (c.position_kind IS DISTINCT FROM i.parse_artifact#>>'{progression,kind}' OR c.position_number IS DISTINCT FROM (i.parse_artifact#>>'{progression,number}')::numeric)) OR EXISTS(SELECT 1 FROM favorite_progress fp JOIN progression_observation o ON o.id=fp.observation_id WHERE o.user_id=i.user_id AND o.provenance->>'installationId'=i.installation_id AND o.provenance->>'bookmarkId'=i.bookmark_id AND fp.position_kind='chapter' AND fp.position_number BETWEEN 1900 AND EXTRACT(year FROM now())+1 AND o.provenance->>'evidence'='numeric-url-segment-after-source-identity' AND fp.position_number IS DISTINCT FROM (i.parse_artifact#>>'{progression,number}')::numeric))
      GROUP BY i.user_id,i.installation_id,i.bookmark_id,i.payload,i.parser_version,i.parse_artifact,i.progress_parser_version,l.media_id ORDER BY i.user_id,i.installation_id,i.bookmark_id`,[FAVORITE_IDENTITY_PARSER_VERSION,FAVORITE_PROGRESS_PARSER_VERSION]);
    const items=stale.rows.map((row:any)=>{
      const artifact=parseFavorite({title:String(row.title??''),url:String(row.url??''),source:sourceIdentityFromUrl(String(row.url??''))});
      const corroborated=Boolean(artifact.identity?.transformations.some(item=>(item.kind==='opaque-url-slug-replaced'||item.kind==='numeric-routing-prefix')&&item.corroboratedBy));
      const previousProgression=row.materializedParserDrift??row.oldArtifact?.progression??row.storedCandidate??null;
      const progressionChanged=JSON.stringify(progressionSignature(previousProgression))!==JSON.stringify(progressionSignature(artifact.progression));
      return {...row,artifact,previousProgression,corroborated,progressionChanged,itemKey:hash(`${row.userId}\0${row.installationId}\0${row.bookmarkId}`)};
    });
    const protectedReviews=await client.query("SELECT count(*)::int AS count FROM favorite_review WHERE status IN ('RESOLVED','NO_MATCH') AND decision IS NOT NULL");
    const removedProgressCandidates=await client.query(`SELECT count(*)::int AS count FROM favorite_progress_candidate c JOIN bookmark_import_item i ON i.user_id=c.user_id AND i.installation_id=c.installation_id AND i.bookmark_id=c.bookmark_id WHERE i.event='removed'`);
    const mangaUpdatesRechecks=await client.query(`SELECT count(DISTINCT m.id)::int AS count FROM media m LEFT JOIN provider_progress pp ON pp.media_id=m.id AND pp.provider='mangaupdates' LEFT JOIN mangadex_promotion_state ps ON ps.media_id=m.id WHERE m.type IN ('MANGA','MANHWA','MANHUA') AND (pp.media_id IS NULL OR pp.serialization_status IS NULL OR (pp.latest_chapter IS NULL AND pp.latest_volume IS NULL) OR ps.status='PENDING')`);
    const technical=await client.query(`SELECT count(*)::int AS count FROM favorite_review r WHERE r.status='PENDING' AND r.decision IS NULL AND NOT EXISTS(SELECT 1 FROM favorite_review_candidate c WHERE c.review_id=r.id) AND (COALESCE(r.reason,'')~*'(SQLSTATE|INTERNAL|CONSTRAINT|DUPLICATE|2350[235]|TIMEOUT|RATE_LIMIT|DNS|ECONN|SOCKET)' OR EXISTS(SELECT 1 FROM bookmark_media_link l JOIN media_enrichment_state e ON e.media_id=l.media_id AND e.provider=r.provider AND e.status IN ('FAILED','TERMINAL') WHERE l.user_id=r.user_id AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id AND e.error_code=r.reason))`);
    const preview={parser:FAVORITE_PARSER_ID,version:FAVORITE_IDENTITY_PARSER_VERSION,progressionVersion:FAVORITE_PROGRESS_PARSER_VERSION,staleImports:items.length,progressionsChanged:items.filter((item:any)=>item.progressionChanged).length,removedProgressCandidates:Number(removedProgressCandidates.rows[0]?.count??0),corroboratedTitleRepairs:items.filter((item:any)=>item.corroborated).length,mangaUpdatesRechecks:Number(mangaUpdatesRechecks.rows[0]?.count??0),protectedReviews:Number(protectedReviews.rows[0]?.count??0),technicalPendingReviews:Number(technical.rows[0]?.count??0),itemKeys:items.map((item:any)=>item.itemKey)};
    const previewHash=hash(preview);
    if(!apply){
      await writeFile(proofPath,JSON.stringify({kind:`favlib-${FAVORITE_PARSER_ID}-preview`,createdAt:new Date().toISOString(),previewHash,preview},null,2),{flag:'wx'});
      console.log(JSON.stringify({mode:'preview',proofPath,previewHash,...preview},null,2));return;
    }
    const proof=JSON.parse(await readFile(proofPath,'utf8'));
    if(proof.kind!==`favlib-${FAVORITE_PARSER_ID}-preview`||proof.previewHash!==previewHash)throw new Error('PREVIEW_PROOF_STALE_OR_INVALID');
    const backup=await verifiedBackup(backupManifest!);
    await client.query('BEGIN');
    await client.query("SET LOCAL favlib.resolved_review_repair='on'");
    const before=await invariantSnapshot(client);
    const decisionsBefore=await client.query(`SELECT id,decision FROM favorite_review WHERE decision IS NOT NULL ORDER BY id`);
    let titleRepairs=0,clusterRepairs=0,progressionRepairs=0,candidateRepairs=0;
    const removedCandidateCleanup=await client.query(`DELETE FROM favorite_progress_candidate c USING bookmark_import_item i WHERE i.user_id=c.user_id AND i.installation_id=c.installation_id AND i.bookmark_id=c.bookmark_id AND i.event='removed'`);
    candidateRepairs+=removedCandidateCleanup.rowCount??0;
    for(const item of items as any[]){
      const progressFingerprint=hash(JSON.stringify({parserVersion:FAVORITE_PROGRESS_PARSER_VERSION,raw:item.artifact.raw}));
      await client.query(`UPDATE bookmark_import_item SET parse_artifact=$1::jsonb,parser_id=$2,parser_version=$3,parser_fingerprint=$4,parse_status=$5,progress_parser_version=$6,progress_parser_fingerprint=$7,progress_parse_status=$8
        WHERE user_id=$9 AND installation_id=$10 AND bookmark_id=$11 AND (COALESCE(parser_version,0)<$3 OR COALESCE(progress_parser_version,0)<$6)`,[JSON.stringify(item.artifact),item.artifact.parser,item.artifact.version,item.artifact.fingerprint,item.artifact.status,FAVORITE_PROGRESS_PARSER_VERSION,progressFingerprint,item.artifact.progression?'evidence':'no_evidence',item.userId,item.installationId,item.bookmarkId]);
      const newProgress=item.artifact.progression;
      const removedCandidates=await client.query(`DELETE FROM favorite_progress_candidate WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3 AND ($4::text IS NULL OR position_kind<>$4)`,[item.userId,item.installationId,item.bookmarkId,newProgress?.kind??null]);
      candidateRepairs+=removedCandidates.rowCount??0;
      if(newProgress){
        const source=sourceIdentityFromUrl(String(item.url??''));
        const savedCandidate=await client.query(`INSERT INTO favorite_progress_candidate(user_id,installation_id,bookmark_id,position_kind,position_number,position_raw,raw_title,raw_url,parsed_slug,path_segments,evidence,season,local_position_number,global_position_number)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14)
          ON CONFLICT(user_id,installation_id,bookmark_id,position_kind) DO UPDATE SET position_number=excluded.position_number,position_raw=excluded.position_raw,raw_title=excluded.raw_title,raw_url=excluded.raw_url,parsed_slug=excluded.parsed_slug,path_segments=excluded.path_segments,evidence=excluded.evidence,season=excluded.season,local_position_number=excluded.local_position_number,global_position_number=excluded.global_position_number,last_observed_at=now()
          RETURNING id`,[item.userId,item.installationId,item.bookmarkId,newProgress.kind,newProgress.number,newProgress.raw,item.title??'',item.url,source?.slug??null,JSON.stringify(newProgress.provenance.pathSegments),JSON.stringify(newProgress.provenance),newProgress.season??null,newProgress.localNumber??null,newProgress.globalNumber??null]);
        candidateRepairs+=savedCandidate.rowCount??0;
      }
      const progressionMediaId=item.materializedMediaId??item.mediaId;
      if(item.progressionChanged&&progressionMediaId){
        const old=item.previousProgression;
        const oldNumber=Number(old?.number);
        if(Number.isFinite(oldNumber)){
          // Keep the raw observation for audit, but revoke only the obsolete
          // parser-derived proof. A different/manual observation is untouched.
          const observations=await client.query(`UPDATE progression_observation SET consented=false,confidence='low',provenance=provenance||jsonb_build_object('parserRepair',$1::jsonb,'invalidatedByParser',$2::text)
            WHERE user_id=$3 AND media_id=$4 AND position_kind=$5 AND position_number=$6 AND provenance->>'installationId'=$7 AND provenance->>'bookmarkId'=$8 RETURNING id`,[JSON.stringify({parser:FAVORITE_PARSER_ID,previous:old,next:newProgress??null,raw:item.artifact.raw}),FAVORITE_PARSER_ID,item.userId,progressionMediaId,old.kind,oldNumber,item.installationId,item.bookmarkId]);
          progressionRepairs+=await rebuildMaterializedProgress(client,item.userId,progressionMediaId,old.kind,observations.rows.map((row:any)=>row.id));
        }
      }
      if(item.mediaId&&newProgress)await client.query("UPDATE bookmark_media_link SET status=status WHERE user_id=$1 AND installation_id=$2 AND bookmark_id=$3 AND media_id=$4 AND status IN ('matched','accepted')",[item.userId,item.installationId,item.bookmarkId,item.mediaId]);
      if(item.corroborated&&item.mediaId&&item.artifact.identity){
        const normalized=item.artifact.identity.title.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
        const derived=await client.query(`SELECT id,media_id,text,language,script,kind,connector FROM media_title
          WHERE media_id IN (SELECT $3::text UNION SELECT target_media_id FROM media_identity_merge WHERE source_media_id=$3 UNION SELECT source_media_id FROM media_identity_merge WHERE target_media_id=$3)
            AND kind='source' AND connector='source-url' AND (provenance->>'url'=ANY($1::text[]) OR provenance->>'sourceUrl'=ANY($1::text[])) AND text<>$2`,[[item.url,item.artifact.identity.canonicalUrl],item.artifact.identity.title,item.mediaId]);
        for(const row of derived.rows){
          const repair={parser:FAVORITE_PARSER_ID,previousDerivedTitle:row.text,rawSlug:item.artifact.identity.rawSlug,transformations:item.artifact.identity.transformations};
          const duplicate=await client.query(`SELECT id FROM media_title WHERE media_id=$1 AND normalized_text=$2 AND COALESCE(language,'')=COALESCE($3::text,'') AND COALESCE(script,'')=COALESCE($4::text,'') AND kind=$5 AND COALESCE(connector,'')=COALESCE($6::text,'') AND id<>$7 LIMIT 1`,[row.media_id,normalized,row.language,row.script,row.kind,row.connector,row.id]);
          if(duplicate.rows[0]){
            await client.query(`UPDATE media_title SET provenance=jsonb_set(provenance,'{repairHistory}',COALESCE(provenance->'repairHistory','[]'::jsonb)||$1::jsonb,true) WHERE id=$2`,[JSON.stringify([repair]),duplicate.rows[0].id]);
            await client.query('DELETE FROM media_title WHERE id=$1',[row.id]);
          }else await client.query(`UPDATE media_title SET text=$1,normalized_text=$2,provenance=provenance||jsonb_build_object('repair',$3::jsonb) WHERE id=$4`,[item.artifact.identity.title,normalized,JSON.stringify(repair),row.id]);
          titleRepairs++;
        }
      }
      const title=item.artifact.identity?.title??item.artifact.displayTitle;
      if(title)for(const provider of item.providers??[]){
        if(provider!=='anilist'&&provider!=='mangaupdates')continue;
        const mediaType=provider==='anilist'?'ANIME':'MANGA';const key=collectiveTitleKey({provider,mediaType,parsedTitle:title});
        const cluster=await client.query(`INSERT INTO review_title_cluster(cluster_key,provider,media_type,parsed_title,raw_title_sample) VALUES($1,$2,$3,$4,$5) ON CONFLICT(cluster_key) DO UPDATE SET updated_at=now() RETURNING id`,[key,provider,mediaType,title,item.title]);
        const changed=await client.query(`UPDATE favorite_review SET favorite_title=$1,cluster_id=$2 WHERE user_id=$3 AND installation_id=$4 AND bookmark_id=$5 AND provider=$6 AND decision IS NULL AND cluster_id IS DISTINCT FROM $2`,[title,cluster.rows[0].id,item.userId,item.installationId,item.bookmarkId,provider]);clusterRepairs+=changed.rowCount??0;
      }
      await client.query(`INSERT INTO favorite_parser_repair(user_id,installation_id,bookmark_id,parser_id,matcher_version,status) VALUES($1,$2,$3,$4,'provider-title-v13','COMPLETED') ON CONFLICT DO NOTHING`,[item.userId,item.installationId,item.bookmarkId,FAVORITE_PARSER_ID]);
    }
    const reusable=await client.query(`SELECT pending.user_id AS "userId",pending.cluster_id AS "clusterId",pending.provider,min(COALESCE(NULLIF(resolved.decision->>'mediaId',''),resolved_link.media_id)) AS "mediaId",min(e.external_id) AS "providerId",min(resolved.id::text) AS "sourceReviewId"
      FROM favorite_review pending
      JOIN bookmark_media_link pending_link ON pending_link.user_id=pending.user_id AND pending_link.installation_id=pending.installation_id AND pending_link.bookmark_id=pending.bookmark_id
      JOIN favorite_review resolved ON resolved.user_id=pending.user_id AND resolved.cluster_id=pending.cluster_id AND resolved.provider=pending.provider AND resolved.status='RESOLVED' AND resolved.decision IS NOT NULL
      JOIN bookmark_media_link resolved_link ON resolved_link.user_id=resolved.user_id AND resolved_link.installation_id=resolved.installation_id AND resolved_link.bookmark_id=resolved.bookmark_id
      JOIN media_external_id e ON e.media_id=COALESCE(NULLIF(resolved.decision->>'mediaId',''),resolved_link.media_id) AND e.provider=resolved.provider
        AND e.external_id=COALESCE(NULLIF(resolved.decision->>'providerId',''),NULLIF(resolved.decision->>'externalId',''),e.external_id)
      WHERE pending.status='PENDING' AND pending.decision IS NULL
      GROUP BY pending.user_id,pending.cluster_id,pending.provider
      HAVING count(DISTINCT COALESCE(NULLIF(resolved.decision->>'mediaId',''),resolved_link.media_id))=1 AND count(DISTINCT e.external_id)=1`);
    let propagatedCount=0;
    for(const target of reusable.rows){
      const pending=await client.query(`SELECT id,installation_id,bookmark_id FROM favorite_review WHERE user_id=$1 AND cluster_id=$2 AND provider=$3 AND status='PENDING' AND decision IS NULL FOR UPDATE`,[target.userId,target.clusterId,target.provider]);
      for(const review of pending.rows){
        const moved=await client.query(`UPDATE bookmark_media_link SET media_id=$1,status='matched',evidence=evidence||$2::jsonb WHERE user_id=$3 AND installation_id=$4 AND bookmark_id=$5`,[target.mediaId,JSON.stringify({resolution:`${FAVORITE_PARSER_ID}-decision-reuse`,providerId:target.providerId}),target.userId,review.installation_id,review.bookmark_id]);
        if(!moved.rowCount)continue;
        const resolved=await client.query(`UPDATE favorite_review SET status='RESOLVED',decision=$1::jsonb,resolved_at=now() WHERE id=$2 AND status='PENDING' AND decision IS NULL RETURNING id`,[JSON.stringify({kind:`${FAVORITE_PARSER_ID}-decision-reuse`,sourceReviewId:target.sourceReviewId,provider:target.provider,providerId:target.providerId,mediaId:target.mediaId}),review.id]);
        propagatedCount+=resolved.rowCount??0;
      }
    }
    const noMatches=await client.query(`UPDATE favorite_review pending SET status='NO_MATCH',decision=jsonb_build_object('kind',$1::text,'sourceReviewId',source.id::text),resolved_at=now() FROM favorite_review source WHERE pending.user_id=source.user_id AND pending.cluster_id=source.cluster_id AND pending.provider=source.provider AND pending.status='PENDING' AND pending.decision IS NULL AND source.status='NO_MATCH' AND source.decision IS NOT NULL AND NOT EXISTS(SELECT 1 FROM favorite_review conflict WHERE conflict.user_id=source.user_id AND conflict.cluster_id=source.cluster_id AND conflict.provider=source.provider AND conflict.status='RESOLVED' AND conflict.decision IS NOT NULL) RETURNING pending.id`,[`${FAVORITE_PARSER_ID}-no-match-reuse`]);
    const removed=await client.query(`DELETE FROM favorite_review r WHERE r.status='PENDING' AND r.decision IS NULL AND NOT EXISTS(SELECT 1 FROM favorite_review_candidate c WHERE c.review_id=r.id) AND (COALESCE(r.reason,'')~*'(SQLSTATE|INTERNAL|CONSTRAINT|DUPLICATE|2350[235]|TIMEOUT|RATE_LIMIT|DNS|ECONN|SOCKET)' OR EXISTS(SELECT 1 FROM bookmark_media_link l JOIN media_enrichment_state e ON e.media_id=l.media_id AND e.provider=r.provider AND e.status IN ('FAILED','TERMINAL') WHERE l.user_id=r.user_id AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id AND e.error_code=r.reason)) RETURNING r.id,r.user_id`);
    const legitimate=await client.query(`SELECT DISTINCT r.provider,l.media_id AS "mediaId" FROM favorite_review r JOIN bookmark_media_link l ON l.user_id=r.user_id AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id WHERE r.status='PENDING' AND r.decision IS NULL AND r.provider IN ('anilist','mangaupdates') AND r.reason IN ('AMBIGUOUS','LOW_CONFIDENCE','NO_RESULT','NO_MATCH','TYPE_MISMATCH','FORMAT_MISMATCH','OVA_REQUIRED_NOT_FOUND')`);
    for(const row of legitimate.rows)await client.query("SELECT graphile_worker.add_job($1,$2::json,job_key := $3,max_attempts := 3,job_key_mode := 'replace')",[`${row.provider}-enrichment`,JSON.stringify({mediaId:row.mediaId,forceRefresh:true,repair:FAVORITE_PARSER_ID}),`${FAVORITE_PARSER_ID}-reenrich:${row.provider}:${row.mediaId}`]);
    await client.query(`DELETE FROM personal_notification n WHERE n.kind IN ('FAVORITE_REVIEW_REQUIRED','FAVORITE_UNRESOLVED') AND NOT EXISTS(SELECT 1 FROM favorite_review r WHERE r.user_id=n.user_id AND r.status='PENDING')`);
    await client.query(`INSERT INTO personal_notification(user_id,release_key,kind,payload) SELECT user_id,'favorite-review-queue','FAVORITE_REVIEW_REQUIRED',jsonb_build_object('title','Correspondances à résoudre','message','Des correspondances restent à vérifier.','count',count(DISTINCT COALESCE(cluster_id::text,id::text)),'url','/review') FROM favorite_review WHERE status='PENDING' GROUP BY user_id ON CONFLICT(user_id,release_key,kind) DO UPDATE SET payload=excluded.payload,read_at=NULL`);
    const after=await invariantSnapshot(client);
    if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('REPAIR_INVARIANT_RAW_IMPORT_OR_PROVIDER_ID_CHANGED');
    if(decisionsBefore.rows.length){const decisionsAfter=await client.query(`SELECT id,decision FROM favorite_review WHERE id=ANY($1::uuid[]) ORDER BY id`,[decisionsBefore.rows.map((row:any)=>row.id)]);if(hash(decisionsBefore.rows)!==hash(decisionsAfter.rows))throw new Error('REPAIR_INVARIANT_EXISTING_DECISIONS_CHANGED');}
    const checks=await client.query(`SELECT
      (SELECT count(*)::int FROM favorite_review r WHERE r.status='PENDING' AND r.decision IS NULL AND NOT EXISTS(SELECT 1 FROM favorite_review_candidate c WHERE c.review_id=r.id) AND (COALESCE(r.reason,'')~*'(SQLSTATE|INTERNAL|CONSTRAINT|DUPLICATE|2350[235]|TIMEOUT|RATE_LIMIT|DNS|ECONN|SOCKET)' OR EXISTS(SELECT 1 FROM bookmark_media_link l JOIN media_enrichment_state e ON e.media_id=l.media_id AND e.provider=r.provider AND e.status IN ('FAILED','TERMINAL') WHERE l.user_id=r.user_id AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id AND e.error_code=r.reason))) AS technical_pending,
      (SELECT count(*)::int FROM media_title t JOIN bookmark_media_link l ON l.media_id=t.media_id JOIN bookmark_import_item i ON i.user_id=l.user_id AND i.installation_id=l.installation_id AND i.bookmark_id=l.bookmark_id WHERE t.kind='source' AND t.connector='source-url' AND i.parse_artifact#>>'{identity,title}' IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(i.parse_artifact#>'{identity,transformations}','[]'::jsonb)) transformation WHERE transformation->>'kind' IN ('opaque-url-slug-replaced','numeric-routing-prefix') AND transformation->>'corroboratedBy' IS NOT NULL) AND t.text<>i.parse_artifact#>>'{identity,title}' AND (t.provenance->>'url'=i.payload->>'url' OR t.provenance->>'sourceUrl' IN (i.payload->>'url',i.parse_artifact#>>'{identity,canonicalUrl}'))) AS corroborated_technical_titles,
      (SELECT count(*)::int FROM favorite_review pending WHERE pending.status='PENDING' AND pending.decision IS NULL AND EXISTS(SELECT 1 FROM favorite_review resolved JOIN bookmark_media_link l ON l.user_id=resolved.user_id AND l.installation_id=resolved.installation_id AND l.bookmark_id=resolved.bookmark_id JOIN media_external_id e ON e.media_id=COALESCE(NULLIF(resolved.decision->>'mediaId',''),l.media_id) AND e.provider=resolved.provider AND e.external_id=COALESCE(NULLIF(resolved.decision->>'providerId',''),NULLIF(resolved.decision->>'externalId',''),e.external_id) WHERE resolved.user_id=pending.user_id AND resolved.cluster_id=pending.cluster_id AND resolved.provider=pending.provider AND resolved.status='RESOLVED' GROUP BY resolved.user_id,resolved.cluster_id,resolved.provider HAVING count(DISTINCT e.external_id)=1 AND count(DISTINCT COALESCE(NULLIF(resolved.decision->>'mediaId',''),l.media_id))=1)) AS unique_resolved_pending`);
    if(Number(checks.rows[0].technical_pending)||Number(checks.rows[0].corroborated_technical_titles)||Number(checks.rows[0].unique_resolved_pending))throw new Error(`REPAIR_POSTCONDITION_FAILED:${JSON.stringify({...checks.rows[0],reusableClusters:reusable.rowCount??0,propagated:propagatedCount})}`);
    const summary={previewHash,backup,titleRepairs,candidateRepairs,progressionRepairs,clusterRepairs,protectedReviews:preview.protectedReviews,propagated:propagatedCount,noMatches:noMatches.rowCount??0,technicalReviewsRemoved:removed.rowCount??0,reenrichedClusters:legitimate.rowCount??0,checks:checks.rows[0]};
    await client.query(`INSERT INTO admin_audit_event(actor_user_id,action,target_type,target_id,summary,request_id) VALUES(NULL,$1,'global',NULL,$2::jsonb,$3)`,[`favorite.parser-v${FAVORITE_IDENTITY_PARSER_VERSION}.repair`,JSON.stringify(summary),previewHash]);
    await client.query('COMMIT');console.log(JSON.stringify({mode:'applied',...summary},null,2));
  }catch(error){if(apply)await client.query('ROLLBACK').catch(()=>undefined);throw error}finally{client.release()}
}

main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1}).finally(()=>pool.end());
