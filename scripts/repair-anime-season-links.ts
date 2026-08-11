import { runtimeEnvironment } from '@favlib/config';
import { applyAnimeSeasonLinkRepairBatch, createAnimeSeasonLinkRepairReviews, previewAnimeSeasonLinkRepair } from '@favlib/database/anime-season-link-repair';
import { Pool } from 'pg';
const apply=process.argv.includes('--apply'),confirmed=process.argv.includes('--confirm');
const pool=new Pool({connectionString:runtimeEnvironment().databaseUrl});
async function main(){const client=await pool.connect();try{const preview=await previewAnimeSeasonLinkRepair(client.query.bind(client));if(!apply){console.log(JSON.stringify({mode:'preview',plannedCount:preview.changes.length,anomalyCount:preview.anomalies.length,...preview},null,2));return;}if(!confirmed)throw new Error('REPAIR_CONFIRMATION_REQUIRED: rerun with --apply --confirm');await client.query('BEGIN');try{const repaired=await applyAnimeSeasonLinkRepairBatch(client.query.bind(client),1000);await createAnimeSeasonLinkRepairReviews(client.query.bind(client));await client.query('COMMIT');console.log(JSON.stringify({mode:'apply',repairedCount:repaired.length,repaired},null,2));}catch(error){await client.query('ROLLBACK');throw error;}}finally{client.release();await pool.end();}}
void main().catch(error=>{console.error(error instanceof Error?error.message:error);process.exitCode=1;});
