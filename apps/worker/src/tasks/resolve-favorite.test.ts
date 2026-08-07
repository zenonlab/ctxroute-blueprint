import { describe, expect, it } from "vitest";
import { inferFavoriteMediaType } from "./resolve-favorite.js";

describe("favorite media-type routing", () => {
  it("keeps the parser URL type authoritative over the bookmark label", () => {
    expect(inferFavoriteMediaType("MANGA", "Pandora Hearts - Episode 4 vostfr")).toBe("MANGA");
    expect(inferFavoriteMediaType("MANGA", "Pandora Hearts VF")).toBe("MANGA");
    expect(inferFavoriteMediaType("MANGA", "The title chapter 4")).toBe("MANGA");
  });
});
