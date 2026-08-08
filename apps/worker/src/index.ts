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
import manualReviewProvider from './tasks/manual-review-provider.js';
import reassessFavoriteReviews from './tasks/reassess-favorite-reviews.js';
import mangaDexPromotion from './tasks/mangadex-promotion.js';
import { ROLE_SCHEDULES, ROLE_TASK_NAMES } from './registry.js';
import { buildVersion } from '@favlib/config';
import { recoverProviderRequestOwner } from '@favlib/database/provider-queue';

const runtime=runtimeEnvironment();
const connectionString=runtime.databaseUrl;
const workerRole=process.env.FAVLIB_WORKER_ROLE??'all';
if(workerRole!=='all'&&workerRole!=='reading'&&workerRole!=='interactive')throw new Error(`Unsupported worker role: ${workerRole}`);
type WorkerRole=keyof typeof ROLE_TASK_NAMES;
const role=workerRole as WorkerRole;
const heartbeatService=workerRole==='all'?'worker':`worker-${workerRole}`;
export async function recoverProviderSlots(db:{query:(sql:string,values?:unknown[])=>Promise<{rows?:Array<{provider:string;count:string}>}>},role:WorkerRole){
  // FavLib runs one worker service. A crashed/recreated process cannot release
  // its in-memory provider slots, so reset the durable counters before taking
  // new jobs. Without this recovery every concurrency thread can wait forever.
  await recoverProviderRequestOwner(db,role,'WORKER_RESTART');
  // This process is the sole consumer for its role. Any pre-existing lock on
  // one of its tasks belongs to the crashed/recreated predecessor.
  await db.query(`UPDATE graphile_worker._private_jobs j SET locked_at=NULL,locked_by=NULL
    FROM graphile_worker._private_tasks t
    WHERE j.task_id=t.id AND j.locked_at IS NOT NULL
      AND t.identifier=ANY($1::text[])`,[[...ROLE_TASK_NAMES[role]]]);
  await db.query(`DELETE FROM graphile_worker._private_jobs j USING graphile_worker._private_tasks t
    WHERE j.task_id=t.id AND t.identifier=ANY($1::text[])
      AND j.id NOT IN (SELECT max(kept.id) FROM graphile_worker._private_jobs kept JOIN graphile_worker._private_tasks task ON task.id=kept.task_id WHERE task.identifier=ANY($1::text[]) GROUP BY kept.task_id)`,[[...Object.keys(ROLE_SCHEDULES[role])]]);
}

export async function scheduleRecurring(db:{query:(sql:string,values?:unknown[])=>Promise<unknown>},name:string){
  const providerSweep=name==='anilist-calendar-sweep'||name==='mangaupdates-release-sweep';
  await db.query(`SELECT graphile_worker.add_job($1,'{}'::json,job_key := $2,max_attempts := $4,priority := $3)
    WHERE NOT EXISTS (
      SELECT 1 FROM graphile_worker._private_jobs j
      JOIN graphile_worker._private_tasks t ON t.id=j.task_id
      WHERE t.identifier=$1
    )`,[name,`schedule:${name}`,providerSweep?-100:0,providerSweep?3:1]);
}
if(runtime.nodeEnv!=='test') {
  const schedulerPool=new Pool({connectionString});
  await recoverProviderSlots(schedulerPool,role);
  const heartbeat=async()=>{await schedulerPool.query("INSERT INTO service_heartbeat(service,observed_at,build_version,details) VALUES($1,now(),$2,$3) ON CONFLICT(service) DO UPDATE SET observed_at=excluded.observed_at,build_version=excluded.build_version,details=excluded.details",[heartbeatService,buildVersion(),JSON.stringify({tasks:ROLE_TASK_NAMES[role],role,mode:'direct-heartbeat'})])};
  await heartbeat();
  const schedule=async(name:string,_interval:number)=>scheduleRecurring(schedulerPool,name);
  const schedules=ROLE_SCHEDULES[role];
  const nextRuns=new Map<string,number>();
  for(const [name,interval] of Object.entries(schedules)){await schedule(name,interval);nextRuns.set(name,Date.now()+interval)}
  const tick=async()=>{const now=Date.now();const due=Object.entries(schedules).filter(([name])=>now>=(nextRuns.get(name)??0));await Promise.all([heartbeat(),...due.map(async([name,interval])=>{await schedule(name,interval);nextRuns.set(name,now+interval)})])};
  const timer=setInterval(()=>void tick().catch((error)=>console.error('scheduler error',error)),30_000); timer.unref();
  const runner=await run({
    connectionString,
    concurrency: runtime.workerConcurrency,
    maxPoolSize: runtime.workerConcurrency + 4,
    taskList: workerRole==='interactive' ? {
      'manual-review-provider': async (payload: unknown, helpers) => { await manualReviewProvider(payload, helpers); },
    } : workerRole==='reading' ? {
      availability: async (payload: unknown, helpers) => { await availability(payload as Parameters<typeof availability>[0], helpers); },
      'availability-sweep': async (payload: unknown, helpers) => { await availabilitySweep(payload, helpers); },
      health: async (payload: unknown, helpers) => { await health(payload, helpers); },
      'notification-delivery': async (payload: unknown, helpers) => { await notificationDelivery(payload, helpers); },
      'mangaupdates-release-sweep': async (payload: unknown, helpers) => { await mangaUpdatesReleaseSweep(payload, helpers); },
      'anilist-calendar-sweep': async (payload: unknown, helpers) => { await anilistCalendarSweep(payload, helpers); },
      'anilist-enrichment': async (payload: unknown, helpers) => { await anilistEnrichment(payload, helpers); },
      'mangaupdates-enrichment': async (payload: unknown, helpers) => { await mangaUpdatesEnrichment(payload, helpers); },
      'enrichment-sweep': async (payload: unknown, helpers) => { await enrichmentSweep(payload, helpers); },
      'provider-profile-cover': async (payload: unknown, helpers) => { await providerProfileCover(payload, helpers); },
      'reassess-favorite-reviews': async (payload: unknown, helpers) => { await reassessFavoriteReviews(payload, helpers); },
      'mangadex-promotion': async (payload: unknown, helpers) => { await mangaDexPromotion(payload, helpers); },
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
    },
  });let stopping=false;const shutdown=async()=>{if(stopping)return;stopping=true;clearInterval(timer);await runner.stop();await schedulerPool.end()};process.once('SIGTERM',()=>void shutdown());process.once('SIGINT',()=>void shutdown());
}
