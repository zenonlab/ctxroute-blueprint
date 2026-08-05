import { runtimeEnvironment } from "@favlib/config";
import { Pool } from "pg";
import { prepareTitleCandidates, sourceIdentityFromUrl } from "@favlib/metadata";

const confirm = process.argv.includes("--confirm");
const enqueue = process.argv.includes("--enqueue-missing-favorites");
const repairFavorites = process.argv.includes("--repair-missing-favorites");

const pool = new Pool({ connectionString: runtimeEnvironment().databaseUrl });

const orphanQuery = `
  SELECT m.id, m.type,
    (SELECT count(*)::int FROM media_external_id e WHERE e.media_id=m.id) AS external_ids,
    (SELECT count(*)::int FROM media_title t WHERE t.media_id=m.id) AS titles,
    (SELECT count(*)::int FROM media_relation r WHERE r.target_media_id=m.id OR r.media_id=m.id) AS relations,
    (SELECT count(*)::int FROM provider_payload p WHERE p.media_id=m.id) AS payloads,
    (SELECT count(*)::int FROM media_cover c WHERE c.media_id=m.id) AS covers,
    (SELECT count(*)::int FROM media_banner b WHERE b.media_id=m.id) AS banners
  FROM media m
  WHERE m.id LIKE 'anilist:%'
    AND NOT EXISTS (
      SELECT 1 FROM bookmark_media_link l
      WHERE l.media_id=m.id AND l.status IN ('matched','accepted','review')
    )
    -- Image FKs are RESTRICT: never select a row carrying any local asset.
    AND NOT EXISTS (SELECT 1 FROM media_cover c WHERE c.media_id=m.id)
    AND NOT EXISTS (SELECT 1 FROM media_banner b WHERE b.media_id=m.id)
  ORDER BY m.id`;

const missingFavoriteAnimeQuery = `
  SELECT DISTINCT m.id AS "mediaId"
  FROM media m
  JOIN bookmark_media_link l ON l.media_id=m.id
    AND l.status IN ('matched','accepted','review')
  WHERE m.type='ANIME'
    AND NOT EXISTS (SELECT 1 FROM media_cover c WHERE c.media_id=m.id AND c.status='ACTIVE')
    AND NOT EXISTS (SELECT 1 FROM media_metadata mm WHERE mm.media_id=m.id AND mm.status='ACTIVE')
  ORDER BY m.id`;

const missingFavoriteQuery = `
  SELECT l.user_id AS "userId", l.media_id AS "mediaId", l.bookmark_id AS "bookmarkId",
    COALESCE(i.payload->>'title', '') AS "favoriteTitle",
    COALESCE(i.payload->>'url', '') AS url,
    m.type AS "typeBefore",
    EXISTS (SELECT 1 FROM media_metadata mm WHERE mm.media_id=m.id AND mm.status='ACTIVE') AS "metadataActive",
    EXISTS (SELECT 1 FROM media_cover c WHERE c.media_id=m.id AND c.status='ACTIVE') AS "coverActive"
  FROM bookmark_media_link l
  JOIN media m ON m.id=l.media_id
  LEFT JOIN LATERAL (
    SELECT payload FROM bookmark_import_item bi
    WHERE bi.user_id=l.user_id AND bi.installation_id=l.installation_id AND bi.bookmark_id=l.bookmark_id
    ORDER BY bi.created_at DESC LIMIT 1
  ) i ON true
  WHERE l.status IN ('matched','accepted','review')
    AND (NOT EXISTS (SELECT 1 FROM media_metadata mm WHERE mm.media_id=m.id AND mm.status='ACTIVE')
         OR NOT EXISTS (SELECT 1 FROM media_cover c WHERE c.media_id=m.id AND c.status='ACTIVE'))
  ORDER BY l.media_id`;

async function main() {
  const client = await pool.connect();
  try {
    if (repairFavorites) {
      const rows = await client.query(missingFavoriteQuery);
      const report = rows.rows.map((row) => {
        const source = row.url ? sourceIdentityFromUrl(row.url) : null;
        const prepared = row.url ? prepareTitleCandidates({ bookmarkTitle: row.favoriteTitle, url: row.url, source }) : undefined;
        return {
          userId: row.userId,
          localId: row.mediaId,
          bookmarkId: row.bookmarkId,
          favoriteTitleOriginal: row.favoriteTitle,
          cleanedTitle: prepared?.personal ?? prepared?.urlTitle,
          urlSlug: source?.slug,
          typeBefore: row.typeBefore,
          typeAfter: source?.type,
          provider: source?.type === 'ANIME' ? 'AniList' : source && ['MANGA','MANHWA','MANHUA'].includes(source.type) ? 'MangaUpdates' : undefined,
          status: source ? 'READY' : 'REVIEW',
          reason: source ? undefined : 'URL_IDENTITY_UNRESOLVED',
          url: row.url,
        };
      });
      if (!confirm) {
        console.log(JSON.stringify({ mode: 'preview', repair: 'missing-favorites', count: report.length, report }, null, 2));
        return;
      }
      await client.query('BEGIN');
      const enqueued: string[] = [];
      for (const item of report) {
        if (item.status !== 'READY' || !item.url) continue;
        await client.query("UPDATE media_enrichment_state SET invalidated_at=now(), next_attempt_at=NULL, updated_at=now() WHERE media_id=$1 AND status<>'SUCCESS'", [item.localId]);
        await client.query("SELECT graphile_worker.add_job('resolve-favorite',$1,job_key := $2,max_attempts := 1)", [JSON.stringify({ userId: item.userId, mediaId: item.localId, title: item.favoriteTitleOriginal, url: item.url, syncCycle: 'favorite-repair' }), `favorite-repair:resolve:${item.localId}:${item.bookmarkId}`]);
        enqueued.push(item.localId ?? '');
      }
      await client.query('COMMIT');
      console.log(JSON.stringify({ mode: 'applied', repair: 'missing-favorites', count: report.length, enqueued, report }, null, 2));
      return;
    }
    const preview = await client.query(orphanQuery);
    const missing = await client.query(missingFavoriteAnimeQuery);
    const report = {
      orphanCandidates: preview.rows,
      orphanCandidateCount: preview.rowCount,
      missingFavoriteAnime: missing.rows.map((row) => row.mediaId),
      missingFavoriteAnimeCount: missing.rowCount,
      safeToDelete: preview.rows.every((row) => row.covers === 0 && row.banners === 0),
    };
    if (!confirm) {
      console.log(JSON.stringify({ mode: "preview", ...report }, null, 2));
      return;
    }

    await client.query("BEGIN");
    const favoriteSnapshot = await client.query(`
      SELECT count(*)::int AS links,
        md5(string_agg(id || ':' || coalesce(media_id,'' ) || ':' || status, '|' ORDER BY id)) AS fingerprint
      FROM bookmark_media_link`);
    const coverSnapshot = await client.query(`
      SELECT count(*)::int AS active,
        md5(string_agg(media_id || ':' || coalesce(provider,'') || ':' || coalesce(provider_external_id,''), '|' ORDER BY media_id,provider,provider_external_id)) AS fingerprint
      FROM media_cover WHERE status='ACTIVE'`);
    const ids = preview.rows.map((row) => row.id);
    const deleted = ids.length
      ? await client.query(
          `DELETE FROM media WHERE id=ANY($1::text[])
           AND NOT EXISTS (SELECT 1 FROM bookmark_media_link l WHERE l.media_id=media.id AND l.status IN ('matched','accepted','review'))
           AND NOT EXISTS (SELECT 1 FROM media_cover c WHERE c.media_id=media.id)
           AND NOT EXISTS (SELECT 1 FROM media_banner b WHERE b.media_id=media.id)
           RETURNING id`,
          [ids],
        )
      : { rows: [] };

    const enqueued: string[] = [];
    if (enqueue) {
      for (const row of missing.rows) {
        await client.query(
          "SELECT graphile_worker.add_job('anilist-enrichment',$1,job_key := $2,max_attempts := 1)",
          [JSON.stringify({ mediaId: row.mediaId, syncCycle: "favorite-repair" }), `favorite-repair:anilist:${row.mediaId}`],
        );
        enqueued.push(row.mediaId);
      }
    }

    const favoriteAfter = await client.query(`
      SELECT count(*)::int AS links,
        md5(string_agg(id || ':' || coalesce(media_id,'' ) || ':' || status, '|' ORDER BY id)) AS fingerprint
      FROM bookmark_media_link`);
    const coverAfter = await client.query(`
      SELECT count(*)::int AS active,
        md5(string_agg(media_id || ':' || coalesce(provider,'') || ':' || coalesce(provider_external_id,''), '|' ORDER BY media_id,provider,provider_external_id)) AS fingerprint
      FROM media_cover WHERE status='ACTIVE'`);
    if (
      favoriteSnapshot.rows[0].links !== favoriteAfter.rows[0].links ||
      favoriteSnapshot.rows[0].fingerprint !== favoriteAfter.rows[0].fingerprint ||
      coverSnapshot.rows[0].active !== coverAfter.rows[0].active ||
      coverSnapshot.rows[0].fingerprint !== coverAfter.rows[0].fingerprint
    ) throw new Error("REPAIR_INVARIANT_CHANGED_FAVORITES_OR_COVERS");
    await client.query("COMMIT");
    console.log(JSON.stringify({ mode: "applied", deleted: deleted.rows.map((row) => row.id), enqueued }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(() => pool.end());
