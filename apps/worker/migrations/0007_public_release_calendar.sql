CREATE TABLE public_release_event (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('anilist', 'mangaUpdates')),
  provider_work_id TEXT NOT NULL,
  release_kind TEXT NOT NULL CHECK (release_kind IN ('episode', 'chapter', 'volume', 'special')),
  sequence_number INTEGER,
  occurrence_kind TEXT NOT NULL CHECK (occurrence_kind IN ('DATE', 'INSTANT')),
  occurrence_value TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('SCHEDULED', 'CONFIRMED', 'ESTIMATED', 'CANCELLED')),
  source TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  UNIQUE (provider, provider_work_id, release_kind, sequence_number, occurrence_kind, occurrence_value)
) STRICT;
CREATE INDEX public_release_event_window_idx ON public_release_event (occurrence_kind, occurrence_value, state, id);
CREATE INDEX public_release_event_provider_work_idx ON public_release_event (provider, provider_work_id, occurrence_kind, occurrence_value);
CREATE TABLE public_release_sync_state (
  provider TEXT PRIMARY KEY CHECK (provider IN ('anilist', 'mangaUpdates')),
  cursor TEXT, fetched_at TEXT NOT NULL, parser_version TEXT NOT NULL, rules_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ok', 'degraded', 'failed')), error_code TEXT
) STRICT;
PRAGMA optimize;
