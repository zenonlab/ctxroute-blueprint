CREATE TABLE public_release_generation (
  revision TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('staging', 'active')),
  generated_at TEXT NOT NULL,
  window_from TEXT NOT NULL,
  window_to TEXT NOT NULL,
  event_count INTEGER NOT NULL CHECK (event_count >= 0)
) STRICT;

CREATE TABLE public_release_generation_event (
  generation_revision TEXT NOT NULL REFERENCES public_release_generation(revision),
  id TEXT NOT NULL,
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
  expires_at TEXT NOT NULL,
  PRIMARY KEY (generation_revision, id)
) STRICT;

CREATE TABLE public_release_active_generation (
  id TEXT PRIMARY KEY CHECK (id = 'active'),
  revision TEXT NOT NULL REFERENCES public_release_generation(revision)
) STRICT;


CREATE INDEX public_release_generation_event_cursor_idx
  ON public_release_generation_event (generation_revision, occurrence_value, id);

INSERT INTO public_release_generation (revision, status, generated_at, window_from, window_to, event_count)
SELECT 'legacy-v1', 'active', MAX(fetched_at), MIN(substr(occurrence_value, 1, 10)), MAX(substr(occurrence_value, 1, 10)), COUNT(*)
FROM public_release_event
HAVING COUNT(*) > 0;

INSERT INTO public_release_generation_event (
  generation_revision, id, provider, provider_work_id, release_kind, sequence_label,
  occurrence_kind, occurrence_value, state, source, fetched_at, parser_version, rules_version, expires_at
)
SELECT 'legacy-v1', id, COALESCE(provider_key, provider), provider_work_id, release_kind,
  COALESCE(sequence_label, CAST(sequence_number AS TEXT)), occurrence_kind, occurrence_value,
  state, source, fetched_at, parser_version, rules_version, expires_at
FROM public_release_event;

INSERT INTO public_release_active_generation (id, revision)
SELECT 'active', 'legacy-v1' WHERE EXISTS (SELECT 1 FROM public_release_generation WHERE revision = 'legacy-v1');

PRAGMA optimize;
