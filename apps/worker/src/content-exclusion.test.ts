import { describe, expect, it, vi } from "vitest";
import { excludeFavoriteMediaByTaxonomy, providerContentExclusion } from "./content-exclusion.js";

describe("global content taxonomy exclusion", () => {
  it("applies the same exact policy to AniList tags and MangaUpdates categories", () => {
    expect(providerContentExclusion({ tags: [{ name: "Explicit Sexual Content" }] })).toMatchObject({
      reason: "BLOCKED_CONTENT_TAXONOMY",
      matches: [{ field: "category", raw: "Explicit Sexual Content" }],
    });
    expect(providerContentExclusion({ genres: ["Adult"], categories: [] })).toMatchObject({
      reason: "BLOCKED_CONTENT_TAXONOMY",
      matches: [{ field: "genre", raw: "Adult" }],
    });
    expect(providerContentExclusion({ genres: ["Mature"], categories: ["Adult cast"] })).toBeNull();
  });

  it("preserves the raw favorite and records provider provenance when excluding it", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    await expect(excludeFavoriteMediaByTaxonomy(query, "synthetic-media", "anilist", {
      genres: ["Hentai"], categories: [],
    })).resolves.toBe(true);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[0]?.[0]).toContain("classification_status='excluded'");
    expect(query.mock.calls[0]?.[0]).not.toContain("DELETE FROM bookmark_import_item");
    expect(query.mock.calls[1]?.[1]?.[1]).toContain('"provider":"anilist"');
    expect(query.mock.calls[1]?.[1]?.[1]).toContain('"raw":"Hentai"');
  });
});
