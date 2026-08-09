import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { readFile,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';
import { runtimeEnvironment } from '@favlib/config';
import { applyObsoleteInstallationCleanup,previewObsoleteInstallationCleanup } from '@favlib/database/obsolete-installation-cleanup';

const exec=promisify(execFile);
const apply=process.argv.includes('--apply');
const summaryOnly=process.argv.includes('--summary');
function argument(name:string){
  const inline=process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
  const index=process.argv.indexOf(`--${name}`);
  return inline || (index>=0 ? process.argv[index+1] : undefined);
}
const userId=argument('user-id');
const installationId=argument('installation-id');
const verifiedBackupManifest=argument('verified-backup-manifest');
if(!userId||!/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(userId)||!installationId)throw new Error('usage: --user-id <uuid> --installation-id <id> [--apply] [--summary]');

const runtime=runtimeEnvironment();
const pool=new Pool({connectionString:runtime.databaseUrl});

async function createAndVerifyBackup(){
  if(!runtime.backupDestination?.startsWith('/'))throw new Error('BACKUP_DESTINATION must be an absolute server-managed path');
  if(!verifiedBackupManifest){
    await exec('corepack',['pnpm','--filter','@favlib/api','backup:create'],{cwd:process.cwd()});
    await exec('corepack',['pnpm','--filter','@favlib/api','backup:verify'],{cwd:process.cwd()});
  }else if(verifiedBackupManifest.includes('/')||!verifiedBackupManifest.endsWith('.json'))throw new Error('VERIFIED_BACKUP_MANIFEST_FILENAME_REQUIRED');
  const manifests=(await readdir(runtime.backupDestination)).filter(file=>file.endsWith('.json')).sort();
  const records=await Promise.all(manifests.map(async file=>({file,...JSON.parse(await readFile(join(runtime.backupDestination!,file),'utf8'))})));
  const latest=verifiedBackupManifest?records.find(record=>record.file===verifiedBackupManifest):records.at(-1);
  const verifiedRollback=records.filter(record=>record.restoreTest==='VERIFIED').at(-1);
  if(!latest||Date.now()-Date.parse(String(latest.createdAt))>10*60*1000)throw new Error('FRESH_BACKUP_NOT_FOUND_AFTER_CREATE');
  if(!verifiedRollback)throw new Error('VERIFIED_RESTORE_BACKUP_REQUIRED');
  if(verifiedBackupManifest){
    if(!runtime.backupKeyFile)throw new Error('BACKUP_KEY_FILE required');
    const encrypted=join(runtime.backupDestination,verifiedBackupManifest.replace(/\.json$/u,'.dump.age'));
    const checksum=createHash('sha256').update(await readFile(encrypted)).digest('hex');
    if(checksum!==latest.sha256)throw new Error('FRESH_BACKUP_CHECKSUM_INVALID');
    await exec('age',['-d','-i',runtime.backupKeyFile,'-o','/dev/null',encrypted]);
  }
  return {freshManifest:latest.file,freshChecksum:latest.sha256,verifiedRollbackManifest:verifiedRollback.file};
}

async function main(){
  const client=await pool.connect();
  try{
    const before=await previewObsoleteInstallationCleanup(client.query.bind(client) as never,userId,installationId);
    if(!apply){
      console.log(JSON.stringify({mode:'dry-run',mutationCount:0,summary:before.summary,...(summaryOnly?{}:{identityAndProgressionChecks:before.identityAndProgressionChecks})},null,2));
      return;
    }
    client.release();
    const backup=await createAndVerifyBackup();
    const transaction=await pool.connect();
    try{
      await transaction.query('BEGIN');
      const mutation=await applyObsoleteInstallationCleanup(transaction.query.bind(transaction) as never,userId,installationId);
      const after=await previewObsoleteInstallationCleanup(transaction.query.bind(transaction) as never,userId,installationId);
      if(Number(after.summary.activeLinkCount)!==0)throw new Error('OBSOLETE_INSTALLATION_ACTIVE_LINKS_REMAIN');
      if(Number(after.summary.importCount)!==Number(before.summary.importCount)
        ||Number(after.summary.reviewCount)!==Number(before.summary.reviewCount)
        ||Number(after.summary.candidateCount)!==Number(before.summary.candidateCount)
        ||Number(after.summary.progressCandidateCount)!==Number(before.summary.progressCandidateCount))throw new Error('OBSOLETE_INSTALLATION_HISTORY_CHANGED');
      await transaction.query('COMMIT');
      console.log(JSON.stringify({mode:'apply',backup,mutation,before:summaryOnly?before.summary:before,after:summaryOnly?after.summary:after},null,2));
    }catch(error){await transaction.query('ROLLBACK');throw error}finally{transaction.release()}
  }finally{
    // The preview connection may already have been released before backup.
    try{client.release()}catch{}
  }
}

void main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1}).finally(()=>pool.end());
