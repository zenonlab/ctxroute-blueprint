CREATE TABLE favorite_ambiguity_sets (
  owner_id TEXT NOT NULL REFERENCES favorite_owners(owner_id),
  key_id TEXT NOT NULL REFERENCES favorite_keys(key_id),
  identities_json TEXT NOT NULL CHECK (
    json_valid(identities_json)
    AND json_type(identities_json) = 'array'
    AND json_array_length(identities_json) BETWEEN 2 AND 6
    AND length(identities_json) <= 4096
  ),
  updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
  PRIMARY KEY (owner_id, key_id)
) STRICT;

PRAGMA optimize;
