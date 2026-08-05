import { Pool } from "pg";
import { fetchAniList } from "@favlib/metadata";
import { runtimeEnvironment } from "@favlib/config";

const pool = new Pool({ connectionString: runtimeEnvironment().databaseUrl });

const sqlMode = process.argv.includes("--sql");

async function main() {
  const client = await pool.connect();
  try {
    const rows = await client.query(`
      SELECT c.id, c.provider_id AS "providerId"
      FROM favorite_review_candidate c
      JOIN favorite_review r ON r.id=c.review_id
      WHERE r.provider='anilist' AND r.status='PENDING'
        AND (c.image IS NULL OR c.image='')
      ORDER BY c.created_at, c.id
    `);
    let updated = 0;
    let missing = 0;
    for (const row of rows.rows) {
      try {
        const media = await fetchAniList(Number(row.providerId));
        if (!media.coverImage) {
          missing++;
          console.log(JSON.stringify({ providerId: row.providerId, status: "NO_COVER" }));
          continue;
        }
        if (sqlMode) {
          const quote = (value: string) => value.replaceAll("'", "''");
          console.log(`UPDATE favorite_review_candidate c SET image='${quote(media.coverImage)}', payload=jsonb_set(c.payload, '{coverImage}', to_jsonb('${quote(media.coverImage)}'::text), true) FROM favorite_review r WHERE c.review_id=r.id AND c.provider_id='${quote(String(row.providerId))}' AND r.provider='anilist' AND r.status='PENDING' AND COALESCE(c.image,'')='';`);
          continue;
        }
        await client.query(
          `UPDATE favorite_review_candidate
           SET image=$2, payload=jsonb_set(payload, '{coverImage}', to_jsonb($2::text), true)
           WHERE id=$1`,
          [row.id, media.coverImage],
        );
        updated++;
        console.log(JSON.stringify({ providerId: row.providerId, status: "UPDATED", cover: media.coverImage }));
      } catch (error) {
        missing++;
        console.log(JSON.stringify({ providerId: row.providerId, status: "ERROR", error: error instanceof Error ? error.message : String(error) }));
      }
    }
    console.log(JSON.stringify({ scanned: rows.rowCount, updated, missing }));
  } finally {
    client.release();
    await pool.end();
  }
}

void main();
