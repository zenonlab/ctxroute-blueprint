import { run } from 'graphile-worker';
import { runtimeEnvironment } from '@favlib/config';
import { Pool } from 'pg';
import availability from './tasks/availability.js';
import availabilitySweep from './tasks/availability-sweep.js';
import announcementSync from './tasks/announcement-sync.js';
import backup from './tasks/backup.js';
import coverRecompress from './tasks/cover-recompress.js';
import health from './tasks/health.js';
import notificationDelivery from './tasks/notification-delivery.js';
import retentionPurge from './tasks/retention-purge.js';
import resolveFavorite from './tasks/resolve-favorite.js';
import anilistEnrichment from './tasks/anilist-enrichment.js';
import mangaUpdatesEnrichment from './tasks/mangaupdates-enrichment.js';
import enrichmentSweep from './tasks/enrichment-sweep.js';
import mangaUpdatesReleaseSweep from './tasks/mangaupdates-release-sweep.js';
import anilistCalendarSweep from './tasks/anilist-calendar-sweep.js';
import providerProfileCover from './tasks/provider-profile-cover.js';
import { SCHEDULES } from './registry.js';
import { WORKER_TASK_NAMES } from './registry.js';
import { buildVersion } from '@favlib/config';

const runtime=runtimeEnvironment();
const connectionString=runtime.databaseUrl;
const workerRole=process.env.FAVLIB_WORKER_ROLE??'all';
const heartbeatService=workerRole==='reading'?'worker-reading':'worker';
export async function recoverProviderSlots(db:{query:(sql:string)=>Promise<unknown>}){
  // FavLib runs one worker service. A crashed/recreated process cannot release
  // its in-memory provider slots, so reset the durable counters before taking
  // new jobs. Without this recovery every concurrency thread can wait forever.
  await db.query('UPDATE provider_request_gate SET in_flight=0,updated_at=now() WHERE in_flight<>0');
  // A waitlist row is owned by the in-memory caller that created it. After a
  // process restart nobody can resume that polling loop, so keeping it WAITING
  // would leave an orphan at the head and block the entire provider lane.
  await db.query("UPDATE provider_request_waitlist SET state='FAILED',completed_at=now(),last_error='WORKER_RESTART' WHERE state IN ('WAITING','RUNNING')");
}
if(runtime.nodeEnv!=='test') {
  const schedulerPool=new Pool({connectionString});
  await recoverProviderSlots(schedulerPool);
  const heartbeat=async()=>{await schedulerPool.query("INSERT INTO service_heartbeat(service,observed_at,build_version,details) VALUES($1,now(),$2,$3) ON CONFLICT(service) DO UPDATE SET observed_at=excluded.observed_at,build_version=excluded.build_version,details=excluded.details",[heartbeatService,buildVersion(),JSON.stringify({tasks:WORKER_TASK_NAMES,role:workerRole,mode:'direct-heartbeat'})])};
  await heartbeat();
  const schedule=async(name:string,interval:number)=>{const bucket=Math.floor(Date.now()/interval);await schedulerPool.query("SELECT graphile_worker.add_job($1,'{}'::json,job_key := $2,max_attempts := 1)",[name,`schedule:${name}:${bucket}`])};
  for(const [name,interval] of Object.entries(SCHEDULES)) await schedule(name,interval);
  const timer=setInterval(()=>void Promise.all([heartbeat(),...Object.entries(SCHEDULES).map(([name,interval])=>schedule(name,interval))]).catch((error)=>console.error('scheduler error',error)),30_000); timer.unref();
  const runner=await run({
    connectionString,
    concurrency: runtime.workerConcurrency,
    maxPoolSize: runtime.workerConcurrency + 4,
    taskList: workerRole==='reading' ? {
      availability: async (payload: unknown, helpers) => { await availability(payload as Parameters<typeof availability>[0], helpers); },
      'availability-sweep': async (payload: unknown, helpers) => { await availabilitySweep(payload, helpers); },
      health: async (payload: unknown, helpers) => { await health(payload, helpers); },
      'notification-delivery': async (payload: unknown, helpers) => { await notificationDelivery(payload, helpers); },
      'mangaupdates-release-sweep': async (payload: unknown, helpers) => { await mangaUpdatesReleaseSweep(payload, helpers); },
      'provider-profile-cover': async (payload: unknown, helpers) => { await providerProfileCover(payload, helpers); },
    } : {
      availability: async (payload: unknown, helpers) => { await availability(payload as Parameters<typeof availability>[0], helpers); },
      'availability-sweep': async (payload: unknown, helpers) => { await availabilitySweep(payload, helpers); },
      'announcement-sync': async (payload: unknown, helpers) => { await announcementSync(payload, helpers); },
      backup: async (payload: unknown, helpers) => { await backup(payload as Parameters<typeof backup>[0], helpers); },
      'cover-recompress': async (payload: unknown, helpers) => { await coverRecompress(payload, helpers); },
      health: async (payload: unknown, helpers) => { await health(payload, helpers); },
      'notification-delivery': async (payload: unknown, helpers) => { await notificationDelivery(payload, helpers); },
      'retention-purge': async (payload: unknown, helpers) => { await retentionPurge(payload, helpers); },
      'resolve-favorite': async (payload: unknown, helpers) => { await resolveFavorite(payload, helpers); },
      'anilist-enrichment': async (payload: unknown, helpers) => { await anilistEnrichment(payload, helpers); },
      'mangaupdates-enrichment': async (payload: unknown, helpers) => { await mangaUpdatesEnrichment(payload, helpers); },
      'enrichment-sweep': async (payload: unknown, helpers) => { await enrichmentSweep(payload, helpers); },
      'mangaupdates-release-sweep': async (payload: unknown, helpers) => { await mangaUpdatesReleaseSweep(payload, helpers); },
      'anilist-calendar-sweep': async (payload: unknown, helpers) => { await anilistCalendarSweep(payload, helpers); },
    },
  });let stopping=false;const shutdown=async()=>{if(stopping)return;stopping=true;clearInterval(timer);await runner.stop();await schedulerPool.end()};process.once('SIGTERM',()=>void shutdown());process.once('SIGINT',()=>void shutdown());
}
