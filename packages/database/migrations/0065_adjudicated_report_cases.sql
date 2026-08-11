-- Adjudicated warnings. Cases contain only shared/sanitized subject evidence;
-- personal submissions remain user-owned and are removed with the account.
CREATE TABLE report_case (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  family text NOT NULL CHECK (family IN ('IDENTITY','SOURCE')),
  subject_key text NOT NULL,
  evidence_revision text NOT NULL,
  media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','FINAL','REVERTED')),
  sanitized_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  report_count integer NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  verdict text,
  decision_scope text,
  chosen_profile_id uuid REFERENCES provider_profile(id) ON DELETE RESTRICT,
  chosen_provider text,
  chosen_provider_id text,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  reverted_at timestamptz,
  UNIQUE(subject_key,evidence_revision)
);
CREATE INDEX report_case_pending_idx ON report_case(status,created_at);

CREATE TABLE report_submission (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES report_case(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  reason text NOT NULL,
  details text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(case_id,user_id)
);

-- Current authority is explicit and reversible; original parser/review rows stay immutable.
CREATE TABLE admin_identity_override (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES report_case(id) ON DELETE RESTRICT,
  scope text NOT NULL CHECK (scope IN ('FAVORITE','CLUSTER')),
  bookmark_link_id uuid REFERENCES bookmark_media_link(id) ON DELETE RESTRICT,
  review_id uuid REFERENCES favorite_review(id) ON DELETE RESTRICT,
  cluster_id uuid REFERENCES review_title_cluster(id) ON DELETE RESTRICT,
  old_media_id text REFERENCES media(id) ON DELETE RESTRICT,
  new_media_id text NOT NULL REFERENCES media(id) ON DELETE RESTRICT,
  chosen_profile_id uuid REFERENCES provider_profile(id) ON DELETE RESTRICT,
  provenance jsonb NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz
);

CREATE TABLE source_association_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES report_case(id) ON DELETE RESTRICT,
  media_id text NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  canonical_url text NOT NULL,
  user_id uuid REFERENCES app_user(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('KEEP','BLOCK')),
  evidence_revision text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  UNIQUE(case_id)
);
CREATE INDEX source_association_active_idx ON source_association_decision(media_id,canonical_url,user_id) WHERE active;

CREATE TABLE report_case_audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES report_case(id) ON DELETE RESTRICT,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL,
  action text NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX report_case_audit_idx ON report_case_audit_event(case_id,created_at);

-- Legacy dead-link feedback remains health telemetry and never adjudicates identity.
ALTER TABLE source_report DROP CONSTRAINT IF EXISTS source_report_reason_check;
ALTER TABLE source_report ADD CONSTRAINT source_report_reason_check CHECK(reason IN ('DEAD_LINK','WRONG_WORK','WRONG_LANGUAGE','UNSTABLE_WORK_PAGE','WRONG_EDITION','WRONG_ACCESS_MODE','UNRELATED_OR_UNSAFE','OTHER_SOURCE','OTHER'));
