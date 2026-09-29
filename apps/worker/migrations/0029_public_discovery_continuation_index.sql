CREATE INDEX public_discovery_v3_continuation
  ON public_discovery_requests_v3(claim_token_hash)
  WHERE claim_token_hash IS NOT NULL;

PRAGMA optimize;
