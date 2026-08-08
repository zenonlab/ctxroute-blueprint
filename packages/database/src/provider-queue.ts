import { randomUUID } from 'node:crypto';

type Query={query:(sql:string,values?:unknown[])=>Promise<{rows?:any[];rowCount?:number|null}>};
export type ProviderQueueName='anilist'|'mangaupdates'|'mangadex';

export async function recoverProviderRequestOwner(db:Query,ownerService:string,error='PROCESS_RESTART'){
  const running=await db.query("SELECT provider,count(*)::text AS count FROM provider_request_waitlist WHERE state='RUNNING' AND owner_service=$1 GROUP BY provider",[ownerService]);
  await db.query("UPDATE provider_request_waitlist SET state='FAILED',completed_at=now(),last_error=$2 WHERE state IN ('WAITING','RUNNING') AND owner_service=$1",[ownerService,error]);
  for(const row of running.rows??[])await db.query("UPDATE provider_request_gate SET in_flight=GREATEST(0,in_flight-$2::integer),updated_at=now() WHERE provider=$1",[row.provider,Number(row.count)]);
}

export async function acquireProviderRequest(db:Query,input:{provider:ProviderQueueName;kind:string;priority?:number;scopeKey?:string|null;userId?:string|null;spacingMs:number;ownerService?:string}){
  const id=randomUUID();
  const owner=input.ownerService??process.env.FAVLIB_WORKER_ROLE??'api';
  await db.query(`INSERT INTO provider_request_waitlist(id,provider,request_kind,priority,scope_key,user_id,state,not_before,owner_service)
    VALUES($1,$2,$3,$4,$5,$6,'WAITING',now(),$7)`,[id,input.provider,input.kind,input.priority??50,input.scopeKey??null,input.userId??null,owner]);
  for(;;){
    const claimed=await db.query(`WITH head AS MATERIALIZED (
        SELECT id FROM provider_request_waitlist
        WHERE provider=$2 AND state='WAITING' AND not_before<=now()
        ORDER BY priority DESC,created_at,id LIMIT 1
      ), slot AS (
        UPDATE provider_request_gate SET in_flight=in_flight+1,
          next_allowed_at=now()+($3::double precision*interval '1 millisecond'),updated_at=now()
        WHERE provider=$2 AND next_allowed_at<=now()
          AND (blocked_until IS NULL OR blocked_until<=now()) AND in_flight<max_in_flight
          AND (SELECT id FROM head)=$1 RETURNING provider
      ) UPDATE provider_request_waitlist SET state='RUNNING',started_at=now(),attempt_count=attempt_count+1
        WHERE id=$1 AND EXISTS(SELECT 1 FROM slot) RETURNING id`,[id,input.provider,input.spacingMs]);
    if(claimed.rowCount)break;
    await new Promise(resolve=>setTimeout(resolve,50));
  }
  let released=false;
  return async(error?:unknown)=>{if(released)return;released=true;try{
    await db.query("UPDATE provider_request_gate SET in_flight=GREATEST(0,in_flight-1),updated_at=now() WHERE provider=$1",[input.provider]);
    await db.query("UPDATE provider_request_waitlist SET state=$2,completed_at=now(),last_error=$3 WHERE id=$1",[id,error?'FAILED':'COMPLETED',error instanceof Error?error.message.slice(0,500):error?String(error).slice(0,500):null]);
  }catch(failure){throw failure}};
}

export async function withProviderRequest<T>(db:Query,input:{provider:ProviderQueueName;kind:string;priority?:number;scopeKey?:string|null;userId?:string|null;spacingMs:number;ownerService?:string},call:()=>Promise<T>){
  const release=await acquireProviderRequest(db,input);
  try{const result=await call();await release();return result}catch(error){await release(error);throw error}
}
