import { describe, expect, it } from "vitest";
import resolveFavorite, { inferFavoriteMediaType } from "./resolve-favorite.js";

describe("favorite media-type routing", () => {
  it("keeps the parser URL type authoritative over the bookmark label", () => {
    expect(inferFavoriteMediaType("MANGA", "Pandora Hearts - Episode 4 vostfr")).toBe("MANGA");
    expect(inferFavoriteMediaType("MANGA", "Pandora Hearts VF")).toBe("MANGA");
    expect(inferFavoriteMediaType("MANGA", "The title chapter 4")).toBe("MANGA");
  });
  it.each(['anilist','mangaupdates'])('makes every legacy %s job a no-op regardless of provenance',async provider=>{
    const queries:string[]=[];
    await resolveFavorite({userId:'00000000-0000-4000-8000-000000000001',mediaId:`source:synthetic-${provider}`,title:'Synthetic Work',url:`https://example.test/${provider}/synthetic`,provenance:{resolver:'unknown-legacy-version'}} as never,{query:async(sql:string)=>{queries.push(sql);return {rows:[],rowCount:0}}} as never);
    expect(queries).toEqual([]);
  });
});
