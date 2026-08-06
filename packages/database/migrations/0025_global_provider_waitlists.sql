CREATE TABLE IF NOT EXISTS provider_request_waitlist (
  id uuid PRIMARY KEY, provider text NOT NULL CHECK(provider IN ('anilist','mangaupdates')),
  request_kind text NOT NULL, priority integer NOT NULL DEFAULT 50,
  scope_key text, user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  state text NOT NULL CHECK(state IN ('WAITING','RUNNING','COMPLETED','FAILED')),
  not_before timestamptz NOT NULL DEFAULT now(),attempt_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),started_at timestamptz,completed_at timestamptz,last_error text
);
CREATE INDEX IF NOT EXISTS provider_request_waitlist_dispatch_idx
  ON provider_request_waitlist(provider,state,priority DESC,not_before,created_at);
COMMENT ON TABLE provider_request_waitlist IS 'Two instance-global provider waitlists. User IDs are context only and never partition quota or scheduling.';
