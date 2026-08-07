-- Review reasons are diagnostic/provenance codes emitted by both provider
-- resolvers. Identity policy is enforced by the shared matcher, not by a
-- single-anime-reason database constraint.
ALTER TABLE favorite_review DROP CONSTRAINT IF EXISTS favorite_review_reason_check;
