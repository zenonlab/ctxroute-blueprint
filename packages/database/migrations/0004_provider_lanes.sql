ALTER TABLE provider_request_gate
  ADD COLUMN IF NOT EXISTS max_in_flight integer NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS in_flight integer NOT NULL DEFAULT 0;

UPDATE provider_request_gate
SET max_in_flight=GREATEST(1, max_in_flight), in_flight=GREATEST(0, in_flight);

INSERT INTO provider_request_gate(provider,max_in_flight)
VALUES ('anilist',2),('mangaupdates',2)
ON CONFLICT(provider) DO NOTHING;
