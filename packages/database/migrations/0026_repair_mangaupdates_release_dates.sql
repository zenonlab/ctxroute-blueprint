-- Releases captured before the public HTML parser understood MangaUpdates day
-- headings were stamped with the observation time. Remove only that legacy
-- key format; the next sweep recreates them with their provider date.
DELETE FROM release_announcement
WHERE provider='mangaupdates' AND release_key LIKE '%|und|none|default';

DELETE FROM mangaupdates_release_observation
WHERE provider_release_key LIKE '%|und|none|default';
