import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const migration = readFileSync(new URL("../migrations/0063_global_content_taxonomy_exclusion.sql", import.meta.url), "utf8");

describe("global content taxonomy migration", () => {
  it("removes obsolete derived metadata and the former opt-in without deleting raw provider payloads", () => {
    expect(migration).toContain("'contentRating'");
    expect(migration).toContain("'publicationDemographic'");
    expect(migration).toContain("DROP COLUMN IF EXISTS allow_adult");
    expect(migration).toContain("array_remove(array_remove(fields,'demographic'),'content-rating')");
    expect(migration).not.toContain("DELETE FROM provider_payload");
    expect(migration).not.toContain("DELETE FROM bookmark_import_item");
  });
});
