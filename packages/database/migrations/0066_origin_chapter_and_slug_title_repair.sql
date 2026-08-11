-- Reparse raw favorites so every surface prefers the stable URL identity over
-- a release-only Chrome label. The repair preserves raw input and provenance.
SELECT graphile_worker.add_job(
  'reassess-favorite-reviews','{"batch":100}'::json,
  job_key := 'review-reassess:favorite-parser-v12',
  max_attempts := 3,priority := -100,job_key_mode := 'replace'
);

-- Refresh durable MangaUpdates records under the connector version that can
-- use an explicit original-status chapter when translation releases omit it.
SELECT graphile_worker.add_job(
  'mangaupdates-enrichment',
  json_build_object('mediaId',e.media_id,'forceRefresh',true)::json,
  job_key := 'mangaupdates-origin-chapter-v28:'||e.media_id,
  max_attempts := 3,priority := -80,job_key_mode := 'replace'
)
FROM media_external_id e
WHERE e.provider='mangaupdates';
