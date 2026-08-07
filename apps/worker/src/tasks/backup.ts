import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir,readFile,rm,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { runtimeEnvironment } from '@favlib/config';
import { Pool } from 'pg';

const exec=promisify(execFile);
type Helpers={query:(text:string,values?:unknown[])=>Promise<{rows:any[];rowCount?:number|null}>};
type Payload={backupId:string;action?:'create'|'verify'|'restore-test'};
const absolute=(value:string|undefined,name:string)=>{if(!value?.startsWith('/'))throw new Error(`${name}_INVALID`);return value};
async function applyCurrentTombstones(source:string,target:string){
  const sourcePool=new Pool({connectionString:source}),targetPool=new Pool({connectionString:target});
  try{
    const tombstones=await sourcePool.query('SELECT entity_type,entity_id FROM deletion_tombstone');
    for(const row of tombstones.rows){
      if(row.entity_type==='user'){
        await targetPool.query('DELETE FROM user_session WHERE user_id=$1',[row.entity_id]);
        await targetPool.query('DELETE FROM app_user WHERE id=$1',[row.entity_id]);
      }
      if(row.entity_type==='device')await targetPool.query('DELETE FROM extension_device WHERE id=$1',[row.entity_id]);
    }
    return tombstones.rowCount??0;
  }finally{await sourcePool.end();await targetPool.end()}
}

export default async function backup(payload:Payload,helpers:Helpers){
  const runtime=runtimeEnvironment();const destination=absolute(runtime.backupDestination,'BACKUP_DESTINATION');const keyFile=absolute(runtime.backupKeyFile,'BACKUP_KEY_FILE');
  const row=await helpers.query('SELECT id,manifest_name AS "manifestName",requested_at AS "requestedAt" FROM backup_run WHERE id=$1',[payload.backupId]);if(!row.rows[0])throw new Error('BACKUP_NOT_FOUND');const action=payload.action??'create';
  const base=`favlib-${payload.backupId}`;const dump=join(destination,`${base}.dump`);const encrypted=join(destination,`${base}.dump.age`);const manifest=join(destination,`${base}.json`);
  try{
    await mkdir(destination,{recursive:true});
    if(action==='create'){
      await helpers.query("UPDATE backup_run SET status='CREATING',error_code=NULL WHERE id=$1",[payload.backupId]);const recipient=(await exec('age-keygen',['-y',keyFile])).stdout.trim();await exec('pg_dump',['-Fc','--no-owner','--file',dump,runtime.databaseUrl]);try{await exec('age',['-r',recipient,'-o',encrypted,dump])}finally{await rm(dump,{force:true})}const data=await readFile(encrypted);const checksum=createHash('sha256').update(data).digest('hex');const completedAt=new Date();await writeFile(manifest,JSON.stringify({format:'pg_dump-custom+age',createdAt:completedAt.toISOString(),sha256:checksum,size:data.length,restoreTest:'NOT_VERIFIED',tombstonesAppliedOnRestore:true},null,2));await helpers.query("UPDATE backup_run SET status='READY',manifest_name=$2,checksum=$3,byte_size=$4,completed_at=$5,rpo_seconds=extract(epoch FROM ($5::timestamptz-requested_at))::bigint WHERE id=$1",[payload.backupId,`${base}.json`,checksum,data.length,completedAt]);return;
    }
    const metadata=JSON.parse(await readFile(manifest,'utf8'));const checksum=createHash('sha256').update(await readFile(encrypted)).digest('hex');if(checksum!==metadata.sha256)throw new Error('CHECKSUM_INVALID');await exec('age',['-d','-i',keyFile,'-o','/dev/null',encrypted]);await helpers.query('UPDATE backup_run SET verified_at=now() WHERE id=$1',[payload.backupId]);
    if(action==='restore-test'){
      if(!runtime.restoreDatabaseUrl)throw new Error('RESTORE_DATABASE_URL_REQUIRED');const started=Date.now();let tombstones=0;try{await exec('age',['-d','-i',keyFile,'-o',dump,encrypted]);await exec('pg_restore',['--exit-on-error','--no-owner','-d',runtime.restoreDatabaseUrl,dump]);tombstones=await applyCurrentTombstones(runtime.databaseUrl,runtime.restoreDatabaseUrl);await exec('psql',[runtime.restoreDatabaseUrl,'-c','ANALYZE'])}finally{await rm(dump,{force:true})}await writeFile(manifest,JSON.stringify({...metadata,restoreTest:'VERIFIED',restoreTestAt:new Date().toISOString(),currentTombstones:tombstones},null,2));await helpers.query('UPDATE backup_run SET restore_tested_at=now(),rto_seconds=$2 WHERE id=$1',[payload.backupId,Math.ceil((Date.now()-started)/1000)]);
    }
  }catch(error){await helpers.query("UPDATE backup_run SET status=CASE WHEN status='READY' THEN status ELSE 'FAILED' END,error_code=$2,completed_at=COALESCE(completed_at,now()) WHERE id=$1",[payload.backupId,error instanceof Error?error.message.slice(0,120):'BACKUP_FAILED']);throw error}
}
