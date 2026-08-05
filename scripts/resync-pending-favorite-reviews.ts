import { runtimeEnvironment } from "@favlib/config";
import { Pool } from "pg";

/** Requeue only still-pending review media. Existing review decisions are
 * never touched; a fresh job key also avoids inheriting max_attempts=1 from
 * the historical queue entries. Run without --apply for an audit report. */
const apply = process.argv.includes("--apply");
const pool = new Pool({ connectionString: runtimeEnvironment().databaseUrl });
type PendingRow = {
  reviewId: string;
  provider: "anilist" | "mangaupdates";
  status: string;
  selectedCandidateId: string | null;
  decision: unknown;
  mediaId: string | null;
  reason: string | null;
};

const pendingSql = `
  SELECT r.id AS "reviewId", r.provider, r.status, r.selected_candidate_id AS "selectedCandidateId",
         r.decision, r.reason, l.media_id AS "mediaId"
  FROM favorite_review r
  LEFT JOIN bookmark_media_link l
    ON l.user_id=r.user_id AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id
  WHERE r.status='PENDING'
  ORDER BY r.created_at, r.id`;

async function main() {
  const db = await pool.connect();
  try {
  const before = (await db.query(pendingSql)).rows as PendingRow[];
  const eligible = before.filter((row) => row.mediaId && row.decision == null && row.reason !== 'MANUAL_REVIEW');
  const jobs = [...new Map(eligible.map((row) => [`${row.provider}:${row.mediaId}`, row] as const)).values()];
  if (apply) {
    await db.query("BEGIN");
    try {
      for (const row of jobs) {
        const task = row.provider === "anilist" ? "anilist-enrichment" : "mangaupdates-enrichment";
        const key = `favorite-review-resync:v2:${row.provider}:${row.mediaId}`;
        await db.query(
          "SELECT graphile_worker.add_job($1,$2::json,job_key := $3,max_attempts := 3)",
          [task, JSON.stringify({ mediaId: row.mediaId, forceRefresh: true, reviewResync: true }), key],
        );
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
  }
  const after = (await db.query(pendingSql)).rows as PendingRow[];
  const preserved = before.every((row, index) => {
    const current = after[index];
    return current?.reviewId === row.reviewId && current.status === row.status &&
      current.selectedCandidateId === row.selectedCandidateId &&
      JSON.stringify(current.decision) === JSON.stringify(row.decision);
  });
  console.log(JSON.stringify({
    mode: apply ? "apply" : "preview",
    pendingBefore: before.length,
    pendingAfter: after.length,
    jobsPlanned: jobs.length,
    jobsRecreated: apply ? jobs.length : 0,
    maxAttempts: 3,
    manualReviewsSkipped: before.filter((row) => row.reason === 'MANUAL_REVIEW').length,
    decidedReviewsSkipped: before.filter((row) => row.decision != null).length,
    decisionsPreserved: preserved,
    reviews: after,
  }, null, 2));
  } finally {
    db.release();
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
