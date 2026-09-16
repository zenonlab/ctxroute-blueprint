ALTER TABLE public_release_generation
  ADD COLUMN events_json TEXT CHECK (events_json IS NULL OR json_valid(events_json));

UPDATE public_release_generation AS generation
SET events_json = (
  SELECT json_group_array(json(event_json))
  FROM (
    SELECT json_patch(json_object(
      'id', event.id,
      'provider', event.provider,
      'providerWorkId', event.provider_work_id,
      'releaseKind', event.release_kind,
      'occurrence', json_object('kind', event.occurrence_kind, 'value', event.occurrence_value),
      'state', event.state,
      'provenance', json_object(
        'source', event.source,
        'fetchedAt', event.fetched_at,
        'parserVersion', event.parser_version,
        'rulesVersion', event.rules_version
      ),
      'expiresAt', event.expires_at
    ), CASE WHEN event.sequence_label IS NULL THEN '{}' ELSE json_object('sequence', event.sequence_label) END) AS event_json
    FROM public_release_generation_event AS event
    WHERE event.generation_revision = generation.revision
    ORDER BY event.id
  )
)
WHERE EXISTS (
  SELECT 1 FROM public_release_generation_event AS event
  WHERE event.generation_revision = generation.revision
);

CREATE TABLE public_release_current_event (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_work_id TEXT NOT NULL,
  release_kind TEXT NOT NULL,
  sequence_label TEXT,
  occurrence_kind TEXT NOT NULL CHECK (occurrence_kind IN ('DATE', 'INSTANT')),
  occurrence_value TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('SCHEDULED', 'CONFIRMED', 'ESTIMATED', 'CANCELLED')),
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  expires_at TEXT NOT NULL
) STRICT;

CREATE INDEX public_release_current_event_cursor_idx
  ON public_release_current_event (occurrence_value, id);

INSERT INTO public_release_current_event (
  id, provider, provider_work_id, release_kind, sequence_label,
  occurrence_kind, occurrence_value, state, source, fetched_at,
  parser_version, rules_version, expires_at
)
SELECT event.id, event.provider, event.provider_work_id, event.release_kind,
  event.sequence_label, event.occurrence_kind, event.occurrence_value,
  event.state, event.source, event.fetched_at, event.parser_version,
  event.rules_version, event.expires_at
FROM public_release_generation_event AS event
JOIN public_release_active_generation AS active
  ON active.id = 'active' AND active.revision = event.generation_revision;

PRAGMA optimize;
