import { describe, expect, it } from "vitest";
import { parseBookmarkTitle, progressionFromFavorite } from "./bookmark-parser.js";

const source = (type: "ANIME" | "MANGA" = "MANGA") => ({ title: "Synthetic Chronicle", type, slug: "synthetic-chronicle" });

describe("shared bookmark progression parser", () => {
  it.each([
    ["Synthetic Chronicle - Chapitre 12", "https://reader.invalid/work", "chapter", 12],
    ["Synthetic Chronicle Épisode 7,5 VOSTFR", "https://video.invalid/work", "episode", 7.5],
    ["Synthetic Chronicle - 18 VOSTFR", "https://video.invalid/work", "episode", 18],
    ["Synthetic Chronicle", "https://reader.invalid/synthetic-chronicle/chapter-4.5", "chapter", 4.5],
  ] as const)("extracts evidenced progression from %s", (title, url, kind, number) => {
    expect(progressionFromFavorite({ title, url, source: source(kind === "episode" ? "ANIME" : "MANGA") })).toMatchObject({ kind, number });
  });

  it("keeps the greatest compatible number in a noisy sequence", () => {
    expect(progressionFromFavorite({title:"Synthetic Chronicle - Chapter 8 - Chapter 11 VOSTFR",url:"https://reader.invalid/work",source:source()})).toMatchObject({kind:"chapter",number:11});
  });

  it("accepts an unlabelled URL segment only with established source identity", () => {
    const input={title:"Synthetic Chronicle",url:"https://reader.invalid/synthetic-chronicle/37"};
    expect(progressionFromFavorite(input)).toBeNull();
    expect(progressionFromFavorite({...input,source:source()})).toMatchObject({kind:"chapter",number:37});
  });

  it("turns a bare trailing number into progression only after validated identity", () => {
    expect(parseBookmarkTitle("Synthetic Chronicle 2")).toBe("Synthetic Chronicle 2");
    expect(progressionFromFavorite({title:"Synthetic Chronicle 2",url:"https://reader.invalid/work"})).toBeNull();
    expect(progressionFromFavorite({title:"Synthetic Chronicle 2",url:"https://reader.invalid/work",source:source()})).toMatchObject({kind:"chapter",number:2,provenance:{matchMethod:"ordered-exact"}});
  });

  it.each([
    ["Chapter 03 - Synthetic Chronicle", "https://reader.invalid/work", "chapter", 3],
    ["Synthetic Chronicle - Episode 09 - VF", "https://video.invalid/work", "episode", 9],
    ["Synthetic Chronicle", "https://reader.invalid/synthetic-chronicle/chapter-12.5/fr", "chapter", 12.5],
  ] as const)("preserves explicit evidence before or after a synthetic title",(title,url,kind,number)=>{
    expect(progressionFromFavorite({title,url,source:source(kind==='episode'?'ANIME':'MANGA')})).toMatchObject({kind,number});
  });

  it.each([
    {title:"Synthetic Chronicle Season 2",url:"https://video.invalid/catalog/synthetic-chronicle"},
    {title:"Synthetic Chronicle",url:"https://reader.invalid/catalog/synthetic-chronicle"},
  ])("keeps pages without a proved release unknown",input=>expect(progressionFromFavorite({...input,source:source('ANIME')})).toBeNull());

  it.each([
    ["Synthetic Chronicle 14", 14],
    ["14 Synthetic Chronicle", 14],
    ["Synthetic Chronicle-14", 14],
    ["Chronicle Synthetic 14", 14],
    ["Synthetic Chronicl 14", 14],
  ] as const)("extracts a generic adjacent number from %s", (title, number) => {
    expect(progressionFromFavorite({title,url:"https://video.invalid/work",source:source("ANIME")})).toMatchObject({kind:"episode",number});
  });

  it("accepts a validated shortened personal alias",()=>{
    expect(progressionFromFavorite({title:"Synthetic 6",url:"https://video.invalid/work",source:{...source("ANIME"),aliases:["Synthetic"]}})).toMatchObject({number:6,provenance:{matchedAlias:"Synthetic"}});
  });

  it("does not strip a number intrinsic to the validated identity",()=>{
    expect(progressionFromFavorite({title:"Synthetic 86",url:"https://video.invalid/work",source:{...source("ANIME"),title:"Synthetic 86"}})).toBeNull();
    expect(progressionFromFavorite({title:"Synthetic 86 9",url:"https://video.invalid/work",source:{...source("ANIME"),title:"Synthetic 86"}})).toMatchObject({number:9});
  });

  it("keeps an ordinal in the identity",()=>expect(progressionFromFavorite({title:"Synthetic 2nd",url:"https://video.invalid/work",source:{...source("ANIME"),title:"Synthetic 2nd"}})).toBeNull());

  it("keeps a matching explicit season as season-only evidence",()=>{
    expect(progressionFromFavorite({title:"Synthetic Chronicle - Saison 2",url:"https://video.invalid/season/2",source:{...source("ANIME"),season:2}})).toBeNull();
  });

  it("preserves title and URL season divergence with a local episode",()=>{
    expect(progressionFromFavorite({title:"Synthetic Chronicle 7 - Saison 3",url:"https://video.invalid/season/2",source:{...source("ANIME"),season:2}})).toMatchObject({number:7,season:2,localNumber:7,provenance:{evidence:"season-divergence",titleSeason:3,urlSeason:2,inputTitle:"Synthetic Chronicle 7 - Saison 3"}});
  });
});
