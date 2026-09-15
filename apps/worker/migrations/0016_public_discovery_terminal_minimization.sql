UPDATE public_discovery_requests_v3
SET request_json = '{}'
WHERE state IN ('VERIFIED', 'NOT_FOUND', 'AMBIGUOUS')
  AND request_json <> '{}';

PRAGMA optimize;
