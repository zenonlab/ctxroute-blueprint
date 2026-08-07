-- Collective review registry. Personal choices are immutable; public provider
-- profiles and anonymous aggregates are shared. Provider audience is display-only.
CREATE TABLE review_title_cluster (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key_version integer NOT NULL DEFAULT 1,
  cluster_key text NOT NULL UNIQUE, provider text NOT NULL CHECK(provider IN ('anilist','mangaupdates')),
  media_type text NOT NULL CHECK(media_type IN ('ANIME','MANGA','MANHWA','MANHUA')),
  parsed_title text NOT NULL, raw_title_sample text NOT NULL,
  explicit_season integer, season_provenance jsonb,
  state text NOT NULL DEFAULT 'PROVISIONAL' CHECK(state IN ('PROVISIONAL','CONFIRMED','SUSPENDED','DISPUTED','HOMONYM_REQUIRED')),
  epoch integer NOT NULL DEFAULT 1, consensus_profile_id uuid REFERENCES provider_profile(id) ON DELETE RESTRICT,
  suspension_cycles integer NOT NULL DEFAULT 0, current_admin_decision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK((provider='anilist' AND media_type='ANIME') OR (provider='mangaupdates' AND media_type IN ('MANGA','MANHWA','MANHUA'))),
  CHECK((explicit_season IS NULL AND season_provenance IS NULL) OR (provider='anilist' AND explicit_season>0 AND season_provenance IS NOT NULL))
);
CREATE TABLE review_cluster_discovery (
  cluster_id uuid NOT NULL REFERENCES review_title_cluster(id) ON DELETE CASCADE,
  connector_version text NOT NULL, status text NOT NULL CHECK(status IN ('RESULTS','EMPTY')),
  searched_at timestamptz NOT NULL DEFAULT now(), result_count integer NOT NULL CHECK(result_count>=0),
  PRIMARY KEY(cluster_id,connector_version), CHECK((status='EMPTY')=(result_count=0))
);
CREATE TABLE review_cluster_candidate (
  cluster_id uuid NOT NULL REFERENCES review_title_cluster(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES provider_profile(id) ON DELETE RESTRICT,
  locked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(cluster_id,profile_id)
);
ALTER TABLE favorite_review ADD COLUMN cluster_id uuid REFERENCES review_title_cluster(id) ON DELETE SET NULL;
ALTER TABLE favorite_review ADD COLUMN review_mode text NOT NULL DEFAULT 'required' CHECK(review_mode IN ('required','optional'));

-- Every authenticated active owner may endorse immediately. Eligibility age is
-- deliberately absent here and applies only to reliable votes and reports.
CREATE TABLE review_cluster_endorsement (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cluster_id uuid NOT NULL REFERENCES review_title_cluster(id) ON DELETE CASCADE,
  epoch integer NOT NULL, user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES provider_profile(id) ON DELETE RESTRICT,
  review_id uuid REFERENCES favorite_review(id) ON DELETE RESTRICT,
  revalidation_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(cluster_id,epoch,user_id), CHECK((review_id IS NOT NULL)::int+(revalidation_id IS NOT NULL)::int=1)
);
CREATE TABLE review_cluster_vote (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), endorsement_id uuid NOT NULL UNIQUE REFERENCES review_cluster_endorsement(id) ON DELETE CASCADE,
  cluster_id uuid NOT NULL REFERENCES review_title_cluster(id) ON DELETE CASCADE, epoch integer NOT NULL,
  user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE, profile_id uuid NOT NULL REFERENCES provider_profile(id) ON DELETE RESTRICT,
  promoted_at timestamptz NOT NULL DEFAULT now(), UNIQUE(cluster_id,epoch,user_id)
);
CREATE TABLE review_cluster_report (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cluster_id uuid NOT NULL REFERENCES review_title_cluster(id) ON DELETE CASCADE,
  epoch integer NOT NULL, user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  review_id uuid NOT NULL REFERENCES favorite_review(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK(reason IN ('WRONG_IDENTITY','WRONG_SEASON','WRONG_MEDIA_TYPE','PROVIDER_RECORD_CHANGED')),
  details text, reliable_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(cluster_id,epoch,user_id)
);
CREATE TABLE review_revalidation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cluster_id uuid NOT NULL REFERENCES review_title_cluster(id) ON DELETE CASCADE,
  epoch integer NOT NULL, user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  prior_review_id uuid NOT NULL REFERENCES favorite_review(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CHOSEN','SKIPPED')),
  selected_profile_id uuid REFERENCES provider_profile(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz, UNIQUE(cluster_id,epoch,user_id)
);
ALTER TABLE review_cluster_endorsement ADD CONSTRAINT review_cluster_endorsement_revalidation_fk
  FOREIGN KEY(revalidation_id) REFERENCES review_revalidation(id) ON DELETE RESTRICT;
CREATE TABLE review_cluster_admin_decision (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cluster_id uuid NOT NULL REFERENCES review_title_cluster(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES app_user(id) ON DELETE SET NULL, action text NOT NULL CHECK(action IN ('CHOOSE','REVERT')),
  selected_profile_id uuid REFERENCES provider_profile(id) ON DELETE RESTRICT,
  previous_state text NOT NULL, previous_consensus_profile_id uuid REFERENCES provider_profile(id) ON DELETE RESTRICT,
  resulting_state text NOT NULL, resulting_consensus_profile_id uuid REFERENCES provider_profile(id) ON DELETE RESTRICT,
  reverted_decision_id uuid REFERENCES review_cluster_admin_decision(id) ON DELETE RESTRICT,
  request_id text, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE review_title_cluster ADD CONSTRAINT review_title_cluster_admin_fk
  FOREIGN KEY(current_admin_decision_id) REFERENCES review_cluster_admin_decision(id) ON DELETE SET NULL;
CREATE TABLE review_cluster_candidate_position_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), cluster_id uuid NOT NULL REFERENCES review_title_cluster(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES provider_profile(id) ON DELETE RESTRICT,
  from_position integer, to_position integer, reason text NOT NULL,
  score jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION favlib_collective_user_eligible(p_cluster_id uuid,p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT EXISTS(SELECT 1 FROM app_user u WHERE u.id=p_user_id AND u.active AND u.created_at<=now()-interval '7 days'
   AND EXISTS(SELECT 1 FROM extension_device d WHERE d.user_id=u.id AND d.revoked_at IS NULL AND d.verified_sync_at IS NOT NULL)
   AND EXISTS(SELECT 1 FROM favorite_review r JOIN bookmark_media_link l ON l.user_id=r.user_id AND l.installation_id=r.installation_id AND l.bookmark_id=r.bookmark_id
     WHERE r.cluster_id=p_cluster_id AND r.user_id=u.id AND r.status='RESOLVED' AND l.status IN ('matched','accepted') AND l.created_at<=now()-interval '24 hours'))
$$;
CREATE OR REPLACE FUNCTION favlib_promote_collective_endorsements(p_cluster_id uuid DEFAULT NULL)
RETURNS integer LANGUAGE plpgsql AS $$ DECLARE promoted integer; BEGIN
 INSERT INTO review_cluster_vote(endorsement_id,cluster_id,epoch,user_id,profile_id)
 SELECT e.id,e.cluster_id,e.epoch,e.user_id,e.profile_id FROM review_cluster_endorsement e
 WHERE (p_cluster_id IS NULL OR e.cluster_id=p_cluster_id) AND favlib_collective_user_eligible(e.cluster_id,e.user_id)
 ON CONFLICT DO NOTHING; GET DIAGNOSTICS promoted=ROW_COUNT; RETURN promoted; END $$;
CREATE OR REPLACE FUNCTION favlib_mark_reliable_report() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN IF favlib_collective_user_eligible(NEW.cluster_id,NEW.user_id) THEN NEW.reliable_at:=COALESCE(NEW.reliable_at,now()); END IF; RETURN NEW; END $$;
CREATE TRIGGER review_cluster_report_reliability BEFORE INSERT OR UPDATE ON review_cluster_report FOR EACH ROW EXECUTE FUNCTION favlib_mark_reliable_report();
CREATE OR REPLACE FUNCTION favlib_provider_audience_signal(payload jsonb) RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
 SELECT GREATEST(CASE WHEN COALESCE(payload->>'popularity','')~'^\d+(\.\d+)?$' THEN (payload->>'popularity')::numeric ELSE 0 END,
 CASE WHEN COALESCE(payload->>'favourites','')~'^\d+(\.\d+)?$' THEN (payload->>'favourites')::numeric ELSE 0 END,
 CASE WHEN COALESCE(payload->>'rating','')~'^\d+(\.\d+)?$' THEN (payload->>'rating')::numeric ELSE 0 END)
$$;
CREATE INDEX review_cluster_candidate_profile_idx ON review_cluster_candidate(profile_id,cluster_id);
CREATE INDEX review_cluster_endorsement_tally_idx ON review_cluster_endorsement(cluster_id,epoch,profile_id);
CREATE INDEX review_cluster_vote_tally_idx ON review_cluster_vote(cluster_id,epoch,profile_id);
CREATE INDEX review_cluster_report_reliable_idx ON review_cluster_report(cluster_id,epoch) WHERE reliable_at IS NOT NULL;
CREATE INDEX review_revalidation_owner_idx ON review_revalidation(user_id,status);
CREATE INDEX review_cluster_admin_history_idx ON review_cluster_admin_decision(cluster_id,created_at DESC,id DESC);
CREATE INDEX review_cluster_position_history_idx ON review_cluster_candidate_position_event(cluster_id,created_at DESC,id DESC);
