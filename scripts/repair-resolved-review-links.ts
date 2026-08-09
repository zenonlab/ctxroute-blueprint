import { runtimeEnvironment } from '@favlib/config';
import { Pool } from 'pg';
import {
  applyResolvedReviewRepairBatch,
  previewResolvedReviewRepair,
  repairPreservationSnapshotSql,
  type ResolvedReviewRepairProof,
} from '@favlib/database/resolved-review-repair';

const apply = process.argv.includes('--apply');
const summaryOnly = process.argv.includes('--summary');
const rawBatchSize = process.argv.find(value => value.startsWith('--batch-size='))?.split('=')[1];
const batchSize = Math.min(1_000, Math.max(1, Number(rawBatchSize ?? 100) || 100));
const pool = new Pool({ connectionString: runtimeEnvironment().databaseUrl });

async function main() {
  const client = await pool.connect();
  const query = client.query.bind(client) as typeof client.query;
  try {
    const preview = await previewResolvedReviewRepair(query as never);
    if (!apply) {
      console.log(JSON.stringify({ mode: 'dry-run', batchSize, mutationCount: 0, plannedCount: preview.changes.length, anomalyCount: preview.anomalies.length, ...(summaryOnly?{}:{changes:preview.changes,anomalies:preview.anomalies}) }, null, 2));
      return;
    }

    const repaired: ResolvedReviewRepairProof[] = [];
    while (true) {
      await client.query('BEGIN');
      try {
        await client.query("SELECT set_config('favlib.resolved_review_repair','on',true)");
        const before = (await client.query(repairPreservationSnapshotSql)).rows[0]?.snapshot;
        const batch = await applyResolvedReviewRepairBatch(query as never, batchSize);
        const after = (await client.query(repairPreservationSnapshotSql)).rows[0]?.snapshot;
        if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('RESOLVED_REVIEW_REPAIR_PRESERVATION_FAILED');
        await client.query('COMMIT');
        repaired.push(...batch);
        if (batch.length < batchSize) break;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    const verification = await previewResolvedReviewRepair(query as never);
    if (verification.changes.length) throw new Error(`RESOLVED_REVIEW_REPAIR_INCOMPLETE:${verification.changes.length}`);
    console.log(JSON.stringify({ mode: 'apply', batchSize, repairedCount: repaired.length, remainingContradictions: 0, anomalyCount: verification.anomalies.length, ...(summaryOnly?{}:{changes:repaired,anomalies:verification.anomalies}) }, null, 2));
  } finally {
    client.release();
  }
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => pool.end());
