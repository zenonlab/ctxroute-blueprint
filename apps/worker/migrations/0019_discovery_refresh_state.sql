ALTER TABLE public_discovery_requests_v3
  ADD COLUMN next_refresh_at TEXT;

ALTER TABLE public_discovery_requests_v3
  ADD COLUMN refresh_state TEXT NOT NULL DEFAULT 'IDLE'
  CHECK (refresh_state IN ('IDLE', 'PENDING', 'PROCESSING'));

ALTER TABLE public_discovery_requests_v3
  ADD COLUMN refresh_attempt_count INTEGER NOT NULL DEFAULT 0
  CHECK (refresh_attempt_count BETWEEN 0 AND 8);

ALTER TABLE public_discovery_requests_v3
  ADD COLUMN refresh_requested_at TEXT;

UPDATE public_discovery_requests_v3
SET next_refresh_at = strftime('%Y-%m-%dT%H:%M:%fZ', verified_at, '+7 days')
WHERE state = 'VERIFIED' AND verified_at IS NOT NULL;

CREATE INDEX public_discovery_v3_refresh_claim
  ON public_discovery_requests_v3(refresh_state, updated_at, fingerprint)
  WHERE state = 'VERIFIED' AND refresh_state IN ('PENDING', 'PROCESSING');

CREATE INDEX public_discovery_v3_refresh_due
  ON public_discovery_requests_v3(next_refresh_at, updated_at)
  WHERE state = 'VERIFIED' AND refresh_state = 'IDLE';

PRAGMA optimize;
