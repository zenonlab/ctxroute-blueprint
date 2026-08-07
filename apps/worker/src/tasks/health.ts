import type { Task } from 'graphile-worker';
import { buildVersion } from '@favlib/config';
import { WORKER_TASK_NAMES } from '../registry.js';

const health:Task=async(_payload,helpers)=>{
  await helpers.query("INSERT INTO service_heartbeat(service,observed_at,build_version,details) VALUES('worker',now(),$1,$2) ON CONFLICT(service) DO UPDATE SET observed_at=excluded.observed_at,build_version=excluded.build_version,details=excluded.details",[buildVersion(),JSON.stringify({tasks:WORKER_TASK_NAMES})]);
};

export default health;
