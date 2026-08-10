-- Adult visibility is no longer a user preference. Provider classifications
-- and demographics are deliberately not retained as catalogue metadata;
-- exclusion uses only the shared exact genre/category taxonomy.
DELETE FROM metadata_assertion
WHERE field IN ('adultCategories','isAdult','contentRating','publicationDemographic');

UPDATE catalog_provider_policy
SET fields=array_remove(array_remove(fields,'demographic'),'content-rating')
WHERE provider='mangadex';

ALTER TABLE user_catalog_preference
  DROP COLUMN IF EXISTS allow_adult;
