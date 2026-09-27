ALTER TABLE public_discovery_requests_v3
  ADD COLUMN search_progress_json TEXT;

PRAGMA optimize;
