ALTER TABLE public_discovery_requests_v3
  ADD COLUMN failure_diagnostics_json TEXT
  CHECK (failure_diagnostics_json IS NULL OR (
    json_valid(failure_diagnostics_json)
    AND json_type(failure_diagnostics_json) = 'array'
    AND json_array_length(failure_diagnostics_json) <= 8
    AND length(failure_diagnostics_json) <= 16384
  ));
