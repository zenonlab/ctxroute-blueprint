CREATE TABLE catalogue_metadata_identity_conflicts (
  work_id TEXT PRIMARY KEY,
  catalogue_media_kind TEXT NOT NULL,
  profile_media_kinds_json TEXT NOT NULL CHECK (json_valid(profile_media_kinds_json)),
  detected_at TEXT NOT NULL
) STRICT;

INSERT INTO catalogue_metadata_identity_conflicts(work_id, catalogue_media_kind, profile_media_kinds_json, detected_at)
SELECT work.work_id, work.media_kind,
  json_group_array(DISTINCT lower(json_extract(request.result_json, '$.profile.candidate.mediaKind'))),
  max(request.verified_at)
FROM catalogue_works AS work
JOIN public_discovery_requests_v3 AS request
  ON json_extract(request.result_json, '$.profile.workId') = work.work_id
WHERE request.state = 'VERIFIED'
GROUP BY work.work_id
HAVING COUNT(DISTINCT CASE
  WHEN json_extract(request.result_json, '$.profile.candidate.mediaKind') = 'ANIME' THEN 'anime'
  ELSE 'manga' END) > 1
  OR max(CASE
    WHEN json_extract(request.result_json, '$.profile.candidate.mediaKind') = 'ANIME' THEN 'anime'
    ELSE 'manga' END) <> work.media_kind;

CREATE TABLE catalogue_current_metadata (
  work_id TEXT PRIMARY KEY REFERENCES catalogue_works(work_id) ON DELETE CASCADE,
  profile_json TEXT NOT NULL CHECK (json_valid(profile_json) AND length(CAST(profile_json AS BLOB)) <= 32768),
  editorial_status TEXT CHECK (editorial_status IS NULL OR editorial_status IN ('UPCOMING', 'ONGOING', 'HIATUS', 'COMPLETED', 'CANCELLED', 'UNKNOWN')),
  format TEXT,
  start_year INTEGER,
  end_year INTEGER,
  episode_total INTEGER CHECK (episode_total IS NULL OR episode_total >= 0),
  chapter_total INTEGER CHECK (chapter_total IS NULL OR chapter_total >= 0),
  volume_total INTEGER CHECK (volume_total IS NULL OR volume_total >= 0),
  last_confirmed_kind TEXT CHECK (last_confirmed_kind IS NULL OR last_confirmed_kind IN ('episode', 'chapter', 'volume')),
  last_confirmed_sequence TEXT,
  last_confirmed_on TEXT,
  cover_url TEXT,
  cover_attribution TEXT,
  genres_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(genres_json) AND json_array_length(genres_json) <= 32),
  categories_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(categories_json) AND json_array_length(categories_json) <= 32),
  content_classification TEXT NOT NULL DEFAULT 'unknown' CHECK (content_classification IN ('adult', 'non-adult', 'unknown')),
  source_provider TEXT NOT NULL,
  source_external_id TEXT NOT NULL,
  value_observed_at TEXT NOT NULL,
  normalization_version INTEGER NOT NULL CHECK (normalization_version > 0),
  revision INTEGER NOT NULL REFERENCES catalogue_revisions(revision)
) STRICT;

INSERT INTO catalogue_current_metadata(
  work_id, profile_json, editorial_status, format, start_year, end_year,
  episode_total, chapter_total, volume_total, cover_url, cover_attribution,
  genres_json, categories_json, content_classification, source_provider,
  source_external_id, value_observed_at, normalization_version, revision)
SELECT work.work_id,
  json_extract(request.result_json, '$.profile'),
  json_extract(request.result_json, '$.profile.candidate.editorialStatus'),
  json_extract(request.result_json, '$.profile.candidate.format'),
  json_extract(request.result_json, '$.profile.candidate.startYear'),
  json_extract(request.result_json, '$.profile.candidate.endYear'),
  json_extract(request.result_json, '$.profile.candidate.episodeCount'),
  json_extract(request.result_json, '$.profile.candidate.chapterCount'),
  json_extract(request.result_json, '$.profile.candidate.volumeCount'),
  json_extract(request.result_json, '$.profile.candidate.cover.url'),
  json_extract(request.result_json, '$.profile.candidate.cover.attribution'),
  COALESCE(json_extract(request.result_json, '$.profile.candidate.genres'), '[]'),
  COALESCE(json_extract(request.result_json, '$.profile.candidate.categories'), '[]'),
  COALESCE(json_extract(request.result_json, '$.profile.candidate.contentClassification'), 'unknown'),
  json_extract(request.result_json, '$.profile.candidate.provider'),
  json_extract(request.result_json, '$.profile.candidate.externalId'),
  request.verified_at, 2, work.revision
FROM catalogue_works AS work
JOIN public_discovery_requests_v3 AS request
  ON request.rowid = (
    SELECT newest.rowid FROM public_discovery_requests_v3 AS newest
    WHERE newest.state = 'VERIFIED'
      AND json_extract(newest.result_json, '$.profile.workId') = work.work_id
    ORDER BY newest.verified_at DESC, newest.updated_at DESC, newest.rowid DESC LIMIT 1)
WHERE NOT EXISTS (SELECT 1 FROM catalogue_metadata_identity_conflicts AS conflict WHERE conflict.work_id = work.work_id);

UPDATE catalogue_current_metadata AS metadata SET
  editorial_status = COALESCE(editorial_status, (SELECT json_extract(result_json, '$.profile.candidate.editorialStatus') FROM public_discovery_requests_v3 WHERE state = 'VERIFIED' AND json_extract(result_json, '$.profile.workId') = metadata.work_id AND json_extract(result_json, '$.profile.candidate.editorialStatus') IS NOT NULL ORDER BY verified_at DESC LIMIT 1)),
  format = COALESCE(format, (SELECT json_extract(result_json, '$.profile.candidate.format') FROM public_discovery_requests_v3 WHERE state = 'VERIFIED' AND json_extract(result_json, '$.profile.workId') = metadata.work_id AND json_extract(result_json, '$.profile.candidate.format') IS NOT NULL ORDER BY verified_at DESC LIMIT 1)),
  start_year = COALESCE(start_year, (SELECT json_extract(result_json, '$.profile.candidate.startYear') FROM public_discovery_requests_v3 WHERE state = 'VERIFIED' AND json_extract(result_json, '$.profile.workId') = metadata.work_id AND json_extract(result_json, '$.profile.candidate.startYear') IS NOT NULL ORDER BY verified_at DESC LIMIT 1)),
  end_year = COALESCE(end_year, (SELECT json_extract(result_json, '$.profile.candidate.endYear') FROM public_discovery_requests_v3 WHERE state = 'VERIFIED' AND json_extract(result_json, '$.profile.workId') = metadata.work_id AND json_extract(result_json, '$.profile.candidate.endYear') IS NOT NULL ORDER BY verified_at DESC LIMIT 1)),
  episode_total = COALESCE(episode_total, (SELECT json_extract(result_json, '$.profile.candidate.episodeCount') FROM public_discovery_requests_v3 WHERE state = 'VERIFIED' AND json_extract(result_json, '$.profile.workId') = metadata.work_id AND json_extract(result_json, '$.profile.candidate.episodeCount') IS NOT NULL ORDER BY verified_at DESC LIMIT 1)),
  chapter_total = COALESCE(chapter_total, (SELECT json_extract(result_json, '$.profile.candidate.chapterCount') FROM public_discovery_requests_v3 WHERE state = 'VERIFIED' AND json_extract(result_json, '$.profile.workId') = metadata.work_id AND json_extract(result_json, '$.profile.candidate.chapterCount') IS NOT NULL ORDER BY verified_at DESC LIMIT 1)),
  volume_total = COALESCE(volume_total, (SELECT json_extract(result_json, '$.profile.candidate.volumeCount') FROM public_discovery_requests_v3 WHERE state = 'VERIFIED' AND json_extract(result_json, '$.profile.workId') = metadata.work_id AND json_extract(result_json, '$.profile.candidate.volumeCount') IS NOT NULL ORDER BY verified_at DESC LIMIT 1)),
  cover_url = COALESCE(cover_url, (SELECT json_extract(result_json, '$.profile.candidate.cover.url') FROM public_discovery_requests_v3 WHERE state = 'VERIFIED' AND json_extract(result_json, '$.profile.workId') = metadata.work_id AND json_extract(result_json, '$.profile.candidate.cover.url') IS NOT NULL ORDER BY verified_at DESC LIMIT 1)),
  cover_attribution = COALESCE(cover_attribution, (SELECT json_extract(result_json, '$.profile.candidate.cover.attribution') FROM public_discovery_requests_v3 WHERE state = 'VERIFIED' AND json_extract(result_json, '$.profile.workId') = metadata.work_id AND json_extract(result_json, '$.profile.candidate.cover.attribution') IS NOT NULL ORDER BY verified_at DESC LIMIT 1));

UPDATE catalogue_current_metadata SET profile_json =
  CASE WHEN editorial_status IS NULL THEN profile_json ELSE json_set(profile_json, '$.candidate.editorialStatus', editorial_status) END;
UPDATE catalogue_current_metadata SET profile_json =
  CASE WHEN format IS NULL THEN profile_json ELSE json_set(profile_json, '$.candidate.format', format) END;
UPDATE catalogue_current_metadata SET profile_json =
  CASE WHEN start_year IS NULL THEN profile_json ELSE json_set(profile_json, '$.candidate.startYear', start_year) END;
UPDATE catalogue_current_metadata SET profile_json =
  CASE WHEN end_year IS NULL THEN profile_json ELSE json_set(profile_json, '$.candidate.endYear', end_year) END;
UPDATE catalogue_current_metadata SET profile_json =
  CASE WHEN episode_total IS NULL THEN profile_json ELSE json_set(profile_json, '$.candidate.episodeCount', episode_total) END;
UPDATE catalogue_current_metadata SET profile_json =
  CASE WHEN chapter_total IS NULL THEN profile_json ELSE json_set(profile_json, '$.candidate.chapterCount', chapter_total) END;
UPDATE catalogue_current_metadata SET profile_json =
  CASE WHEN volume_total IS NULL THEN profile_json ELSE json_set(profile_json, '$.candidate.volumeCount', volume_total) END;
UPDATE catalogue_current_metadata SET profile_json =
  CASE WHEN cover_url IS NULL THEN profile_json ELSE json_set(profile_json, '$.candidate.cover.url', cover_url) END;
UPDATE catalogue_current_metadata SET profile_json =
  CASE WHEN cover_attribution IS NULL THEN profile_json ELSE json_set(profile_json, '$.candidate.cover.attribution', cover_attribution) END;
UPDATE catalogue_current_metadata SET profile_json = json_set(
  profile_json,
  '$.candidate.genres', json(genres_json),
  '$.candidate.categories', json(categories_json),
  '$.candidate.contentClassification', content_classification
);

PRAGMA optimize;
