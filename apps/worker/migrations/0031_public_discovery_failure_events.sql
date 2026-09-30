CREATE TABLE public_discovery_failure_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  fingerprint TEXT NOT NULL,
  media_kind TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  rules_version TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  diagnostic_json TEXT NOT NULL CHECK (
    json_valid(diagnostic_json)
    AND json_type(diagnostic_json) = 'object'
    AND length(diagnostic_json) <= 16384
  )
);

CREATE INDEX public_discovery_failure_events_key
  ON public_discovery_failure_events(fingerprint, media_kind, parser_version, rules_version, event_id);

CREATE TRIGGER public_discovery_failure_event_append
AFTER UPDATE OF failure_diagnostics_json ON public_discovery_requests_v3
WHEN NEW.failure_diagnostics_json IS NOT NULL
  AND json_array_length(NEW.failure_diagnostics_json) > 0
BEGIN
  INSERT INTO public_discovery_failure_events (
    fingerprint, media_kind, parser_version, rules_version, request_digest, diagnostic_json
  ) VALUES (
    NEW.fingerprint, NEW.media_kind, NEW.parser_version, NEW.rules_version,
    NEW.request_digest, json_extract(NEW.failure_diagnostics_json, '$[#-1]')
  );
END;
