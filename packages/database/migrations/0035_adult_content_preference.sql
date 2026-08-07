ALTER TABLE user_catalog_preference
  ADD COLUMN IF NOT EXISTS allow_adult boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN user_catalog_preference.allow_adult IS
  'Owner: user; purpose: explicit opt-in for adult provider metadata; export: account export; retention/purge: cascade with user; restore: remains opt-in and defaults false.';
