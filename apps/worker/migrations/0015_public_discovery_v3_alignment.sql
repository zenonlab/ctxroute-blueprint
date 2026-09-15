ALTER TABLE public_discovery_requests_v2 RENAME TO public_discovery_requests_v3;
ALTER TABLE public_discovery_result_nonces_v2 RENAME TO public_discovery_result_nonces_v3;

CREATE INDEX public_discovery_v3_pending
  ON public_discovery_requests_v3(state, retry_at, updated_at)
  WHERE state IN ('PENDING', 'PROCESSING');

CREATE INDEX public_discovery_v3_failed_retention
  ON public_discovery_requests_v3(purge_after, updated_at)
  WHERE state = 'FAILED' AND purge_after IS NOT NULL;

CREATE INDEX public_discovery_v3_nonce_retention
  ON public_discovery_result_nonces_v3(purge_after, created_at)
  WHERE purge_after IS NOT NULL;

PRAGMA optimize;
