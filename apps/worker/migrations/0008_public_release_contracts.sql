ALTER TABLE public_release_event ADD COLUMN provider_key TEXT
  CHECK (provider_key IN ('anilist', 'mangaupdates'));
ALTER TABLE public_release_event ADD COLUMN sequence_label TEXT
  CHECK (sequence_label IS NULL OR length(sequence_label) BETWEEN 1 AND 64);

UPDATE public_release_event
SET provider_key = CASE provider
  WHEN 'mangaUpdates' THEN 'mangaupdates'
  ELSE provider
END;
UPDATE public_release_event
SET sequence_label = CAST(sequence_number AS TEXT)
WHERE sequence_number IS NOT NULL;

CREATE UNIQUE INDEX public_release_event_identity_v2_idx
  ON public_release_event (
    provider_key,
    provider_work_id,
    release_kind,
    sequence_label,
    occurrence_kind,
    occurrence_value
  );
CREATE INDEX public_release_event_provider_work_v2_idx
  ON public_release_event (provider_key, provider_work_id, occurrence_kind, occurrence_value);

ALTER TABLE public_release_sync_state ADD COLUMN provider_key TEXT
  CHECK (provider_key IN ('anilist', 'mangaupdates'));
UPDATE public_release_sync_state
SET provider_key = CASE provider
  WHEN 'mangaUpdates' THEN 'mangaupdates'
  ELSE provider
END;

PRAGMA optimize;
