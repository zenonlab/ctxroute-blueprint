import { describe, expect, it } from "vitest";
import { FAVORITE_PARSER_ID, parseBookmarkTitle, parseFavorite, progressionFromFavorite } from "./bookmark-parser.js";

const source = (type: "ANIME" | "MANGA" = "MANGA") => ({ title: "Synthetic Chronicle", type, slug: "synthetic-chronicle" });

describe("shared bookmark progression parser", () => {
  it("keeps a synthetic chapter out of every identity alias and preserves raw provenance", () => {
    const raw = { title: "Synthetic Glass Harbor - Chapter 20 - Reader", url: "https://reader.invalid/series/synthetic-glass-harbor/chapter-20" };
    const parsed = parseFavorite({ ...raw, source: { key: "reader.invalid:synthetic-glass-harbor", title: "Synthetic Glass Harbor", slug: "synthetic-glass-harbor", canonicalUrl: "https://reader.invalid/series/synthetic-glass-harbor", type: "MANGA", releaseSuffix: "chapter-20" } });
    expect(parsed).toMatchObject({ parser: FAVORITE_PARSER_ID, version: 8, raw, identity: { slug: "synthetic-glass-harbor", title: "Synthetic Glass Harbor", canonicalUrl: "https://reader.invalid/series/synthetic-glass-harbor" }, displayTitle: "Synthetic Glass Harbor", progression: { kind: "chapter", number: 20, provenance: { inputTitle: raw.title, inputUrl: raw.url, parserVersion: 8 } } });
    expect(parsed.identity?.aliases.map(alias => alias.value).join(" ")).not.toMatch(/chapter|20/iu);
    expect(parsed.segments).toContainEqual(expect.objectContaining({ raw: "Chapter 20", cleaned: null, excludedAs: "progression" }));
  });

  it("replaces an opaque URL identity with one uniquely cleaned human segment",()=>{
    const raw={title:"Synthetic Dragon Archive Chapter 20 [END] - reader.invalid",url:"https://reader.invalid/chapter/kx926534/chapter_20"};
    const parsed=parseFavorite({...raw,source:{title:"Kx926534",slug:"kx926534",rawSlug:"kx926534",type:"MANGA",releaseSuffix:"chapter_20"}});
    expect(parsed).toMatchObject({raw,identity:{title:"Synthetic Dragon Archive",rawSlug:"kx926534",stableSlug:"synthetic-dragon-archive",transformations:[{kind:"opaque-url-slug-replaced",raw:"kx926534"}]},displayTitle:"Synthetic Dragon Archive",progression:{number:20}});
  });

  it("uses two corroborating human segments after removing a parenthesized release badge",()=>{
    const raw={
      title:"Synthetic Aurora Finale OVA - (OAV VOSTFR) Synthetic Aurora Finale OVA - Streamer",
      url:"https://video.invalid/anime/aurora-finale/oav-vostfr-synthetic-aurora-finale-ova/",
    };
    const parsed=parseFavorite({...raw,source:{
      key:"video.invalid:aurora-finale",title:"Oav Vostfr Synthetic Aurora Finale Ova",
      slug:"aurora-finale",rawSlug:"aurora-finale",type:"ANIME",
    }});
    expect(parsed).toMatchObject({
      parser:"favorite-parser-v8",version:8,raw,
      identity:{title:"Synthetic Aurora Finale OVA",stableSlug:"aurora-finale",transformations:[{kind:"repeated-human-title",raw:"Oav Vostfr Synthetic Aurora Finale Ova"}]},
      displayTitle:"Synthetic Aurora Finale OVA",
    });
    expect(parsed.identity?.aliases.map(alias=>alias.value)).toEqual(["Synthetic Aurora Finale OVA"]);
    expect(parsed.segments[1]).toMatchObject({raw:"(OAV VOSTFR) Synthetic Aurora Finale OVA",cleaned:"Synthetic Aurora Finale OVA",transformations:["cleaned_generic_suffix"]});
  });

  it("aligns the human segment when a chapter is followed by a generic call to action",()=>{
    const parsed=parseFavorite({
      title:"Synthetic Glass Harbor [Orbit Reader] - Chapter 20 - Read Free Illustrated Work Online",
      url:"https://reader.invalid/title/482-en-synthetic-glass-harbor-orbit-reader/900-ch_20",
      source:{title:"482 En Synthetic Glass Harbor Orbit Reader",slug:"482-en-synthetic-glass-harbor-orbit-reader",rawSlug:"482-en-synthetic-glass-harbor-orbit-reader",type:"MANGA"},
    });
    expect(parsed).toMatchObject({identity:{title:"Synthetic Glass Harbor",stableSlug:"synthetic-glass-harbor"},displayTitle:"Synthetic Glass Harbor",progression:{number:20}});
  });

  it("cleans a corroborated routing/language/title/reader slug while retaining every raw field", () => {
    const raw = {
      title: "Synthetic Glass Harbor [Orbit Reader] - Chapter 20",
      url: "https://reader.invalid/comic/482-fr-synthetic-glass-harbor-orbit-reader/chapter-20",
    };
    const parsed = parseFavorite({ ...raw, source: {
      key: "reader.invalid:482-fr-synthetic-glass-harbor-orbit-reader",
      title: "482 fr Synthetic Glass Harbor Orbit Reader",
      slug: "482-fr-synthetic-glass-harbor-orbit-reader",
      rawSlug: "482-fr-synthetic-glass-harbor-orbit-reader",
      canonicalUrl: "https://reader.invalid/comic/482-fr-synthetic-glass-harbor-orbit-reader",
      type: "MANGA",
      releaseSuffix: "chapter-20",
    } });
    expect(parsed).toMatchObject({ raw, displayTitle: "Synthetic Glass Harbor", identity: {
      rawSlug: "482-fr-synthetic-glass-harbor-orbit-reader",
      stableSlug: "synthetic-glass-harbor",
      title: "Synthetic Glass Harbor",
      transformations: [
        { kind: "numeric-routing-prefix", raw: "482" },
        { kind: "language-marker", raw: "fr" },
        { kind: "reader-brand-suffix", raw: "Orbit Reader" },
      ],
    }, progression: { kind: "chapter", number: 20 } });
    expect(parsed.identity?.aliases.map(alias => alias.value)).toEqual(["Synthetic Glass Harbor"]);
  });

  it.each([
    ["2048 Synthetic Harbor", "2048-synthetic-harbor"],
    ["Io Synthetic Harbor", "io-synthetic-harbor"],
  ])("does not truncate an uncorroborated title prefix: %s", (title, slug) => {
    const parsed = parseFavorite({ title, url: `https://reader.invalid/comic/${slug}`, source: { title, slug, rawSlug: slug, type: "MANGA" } });
    expect(parsed.identity).toMatchObject({ rawSlug: slug, stableSlug: slug, title, transformations: [] });
  });
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
