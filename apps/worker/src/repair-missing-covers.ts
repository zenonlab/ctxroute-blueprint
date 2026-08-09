import { Pool } from 'pg';
import { runtimeEnvironment } from '@favlib/config';
import { fetchPageMetadata } from '@favlib/metadata';
import { saveCover } from './cover-store.js';

const pool = new Pool({ connectionString: runtimeEnvironment().databaseUrl });
const helpers = {
  query: (sql: string, values?: unknown[]) => pool.query(sql, values),
  logger: { warn: (message: string) => console.warn(message) },
};

const rows = await pool.query(`
  WITH owned AS (
    SELECT DISTINCT l.media_id
    FROM bookmark_media_link l
    WHERE l.media_id IS NOT NULL AND l.status IN ('matched','accepted','review')
  )
  SELECT o.media_id AS "mediaId",mm.source_url AS "sourceUrl",
    (SELECT a.value #>> '{}' FROM metadata_assertion a
     WHERE a.media_id=o.media_id AND a.provider='source-page' AND a.field='sourceImageHint'
     ORDER BY a.asserted_at DESC LIMIT 1) AS "imageHint"
  FROM owned o
  LEFT JOIN media_metadata mm ON mm.media_id=o.media_id AND mm.provider='source-page'
  WHERE NOT EXISTS (SELECT 1 FROM media_cover c WHERE c.media_id=o.media_id AND c.status='ACTIVE')
    AND NOT EXISTS (
      SELECT 1 FROM media_identity_merge im
      JOIN media_cover c ON c.media_id=im.target_media_id AND c.status='ACTIVE'
      WHERE im.source_media_id=o.media_id
    )
  ORDER BY o.media_id
`);

let saved = 0;
let skipped = 0;
for (const row of rows.rows) {
  let image = row.imageHint as string | null;
  if (!image && row.sourceUrl) {
    try {
      image = (await fetchPageMetadata(row.sourceUrl)).image ?? null;
    } catch {
      image = null;
    }
  }
  if (!image) {
    skipped++;
    continue;
  }
  try {
    const result = await saveCover(helpers, row.mediaId, image, 'source-page', 'Source originale', {
      fetch: globalThis.fetch,
      timeoutMs: 8000,
    });
    if (result.status === 'SAVED') saved++;
  } catch {
    skipped++;
  }
}

await pool.end();
console.log(JSON.stringify({ examined: rows.rowCount ?? 0, saved, skipped }));
