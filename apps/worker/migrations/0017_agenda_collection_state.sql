ALTER TABLE public_release_generation ADD COLUMN checked_at TEXT;

UPDATE public_release_generation
SET checked_at = generated_at
WHERE checked_at IS NULL;

CREATE TABLE public_release_agenda_lane_state (
  provider TEXT PRIMARY KEY CHECK (provider IN ('anilist', 'mangaupdates')),
  active_snapshot_id TEXT,
  active_digest TEXT,
  checked_at TEXT,
  last_success_at TEXT,
  completed_for TEXT,
  collection_id TEXT,
  scheduled_for TEXT,
  window_from TEXT,
  window_to TEXT,
  next_page INTEGER NOT NULL DEFAULT 1 CHECK (next_page >= 1),
  received_count INTEGER NOT NULL DEFAULT 0 CHECK (received_count >= 0),
  skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  not_before TEXT,
  lease_token_hash TEXT,
  lease_until TEXT,
  last_error_code TEXT
) STRICT;

CREATE TABLE public_release_agenda_page (
  collection_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('anilist', 'mangaupdates')),
  page INTEGER NOT NULL CHECK (page >= 1),
  events_json TEXT NOT NULL CHECK (json_valid(events_json)),
  event_count INTEGER NOT NULL CHECK (event_count >= 0),
  received_count INTEGER NOT NULL CHECK (received_count >= 0),
  skipped_count INTEGER NOT NULL CHECK (skipped_count >= 0),
  next_page INTEGER CHECK (next_page >= 1),
  complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
  saved_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, provider, page)
) STRICT;

CREATE INDEX public_release_agenda_page_snapshot_idx
  ON public_release_agenda_page (provider, collection_id, page);

INSERT INTO public_release_agenda_lane_state (provider)
VALUES ('anilist'), ('mangaupdates');

PRAGMA optimize;
