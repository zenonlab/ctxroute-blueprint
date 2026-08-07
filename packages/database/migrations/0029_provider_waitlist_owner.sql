ALTER TABLE provider_request_waitlist
  ADD COLUMN IF NOT EXISTS owner_service text;

CREATE INDEX IF NOT EXISTS provider_request_waitlist_owner_active_idx
  ON provider_request_waitlist(owner_service, state)
  WHERE state IN ('WAITING','RUNNING');
