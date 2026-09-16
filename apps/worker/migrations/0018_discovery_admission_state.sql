ALTER TABLE public_discovery_requests_v3
  ADD COLUMN admission_priority INTEGER NOT NULL DEFAULT 3
  CHECK (admission_priority BETWEEN 1 AND 3);

ALTER TABLE public_discovery_requests_v3
  ADD COLUMN result_expires_at TEXT;

ALTER TABLE public_discovery_requests_v3
  ADD COLUMN queue_signal_state TEXT NOT NULL DEFAULT 'UNSENT'
  CHECK (queue_signal_state IN ('UNSENT', 'SENDING', 'SENT'));

ALTER TABLE public_discovery_requests_v3
  ADD COLUMN queue_signal_lease_until TEXT;

UPDATE public_discovery_requests_v3
SET result_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', verified_at, '+7 days')
WHERE state IN ('NOT_FOUND', 'AMBIGUOUS') AND verified_at IS NOT NULL;

UPDATE public_discovery_requests_v3
SET admission_priority = CASE
  WHEN json_type(request_json, '$.query.explicitProviderReference') = 'object' THEN 1
  WHEN json_extract(request_json, '$.query.mediaKind') IN ('ANIME', 'MANGA', 'MANHWA', 'MANHUA') THEN 2
  ELSE 3
END
WHERE state IN ('PENDING', 'PROCESSING') AND request_json <> '{}';

CREATE INDEX public_discovery_v3_claim_priority
  ON public_discovery_requests_v3(admission_priority, updated_at, fingerprint)
  WHERE state IN ('PENDING', 'PROCESSING');

CREATE INDEX public_discovery_v3_negative_expiry
  ON public_discovery_requests_v3(result_expires_at, updated_at)
  WHERE state IN ('NOT_FOUND', 'AMBIGUOUS') AND result_expires_at IS NOT NULL;

CREATE TABLE public_discovery_provider_runtime (
  provider TEXT PRIMARY KEY CHECK (provider IN ('anilist', 'mangaupdates', 'mangadex', 'kitsu-anime', 'kitsu-manga')),
  next_allowed_at INTEGER NOT NULL DEFAULT 0 CHECK (next_allowed_at >= 0),
  active_until INTEGER NOT NULL DEFAULT 0 CHECK (active_until >= 0),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  circuit_open_until INTEGER NOT NULL DEFAULT 0 CHECK (circuit_open_until >= 0),
  updated_at TEXT NOT NULL
) STRICT;

INSERT INTO public_discovery_provider_runtime(provider, updated_at) VALUES
  ('anilist', '1970-01-01T00:00:00.000Z'),
  ('mangaupdates', '1970-01-01T00:00:00.000Z'),
  ('mangadex', '1970-01-01T00:00:00.000Z'),
  ('kitsu-anime', '1970-01-01T00:00:00.000Z'),
  ('kitsu-manga', '1970-01-01T00:00:00.000Z');

PRAGMA optimize;
