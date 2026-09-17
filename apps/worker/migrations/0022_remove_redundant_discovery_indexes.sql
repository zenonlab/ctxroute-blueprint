DROP INDEX IF EXISTS public_discovery_v2_pending;
DROP INDEX IF EXISTS public_discovery_v2_failed_retention;
DROP INDEX IF EXISTS public_discovery_v2_nonce_retention;
DROP INDEX IF EXISTS catalogue_canonical_titles_v1_by_work;

PRAGMA optimize;
