import { describe, expect, it, vi } from "vitest";

const { searchAniList, fetchAniList, saveCover } = vi.hoisted(() => ({
  searchAniList: vi.fn(),
  fetchAniList: vi.fn(),
  saveCover: vi.fn().mockResolvedValue({ status: "SUCCESS" }),
}));

vi.mock("@favlib/metadata", async () => {
  const actual = await vi.importActual<typeof import("@favlib/metadata")>(
    "@favlib/metadata",
  );
  return { ...actual, searchAniList, fetchAniList };
});
vi.mock("../settings.js", () => ({
  operationalValue: vi.fn(async (_h: unknown, key: string) =>
    key === "metadata.maxAttempts" ? 3 : 1000,
  ),
}));
vi.mock("../anilist-gate.js", () => ({ aniListHooks: vi.fn(() => ({})) }));
vi.mock("../cover-store.js", () => ({ saveCover }));
vi.mock("../enrichment-state.js", async () => {
  const actual = await vi.importActual<typeof import("../enrichment-state.js")>(
    "../enrichment-state.js",
  );
  return {
    ...actual,
    claimEnrichment: vi.fn(async () => ({ attempt_count: 1, owner: "test" })),
    finishEnrichment: vi.fn(async () => undefined),
  };
});

import {
  anilistProviderVariants,
  anilistAnchorVariants,
  enrichAniList,
} from "./anilist-enrichment.js";

const anime = {
  id: 176053,
  type: "ANIME" as const,
  title: {
    english: "Good Bye, Dragon Life",
    romaji: "Sayonara Ryuusei, Konnichiwa Jinsei",
    userPreferred: "Sayonara Ryuusei, Konnichiwa Jinsei",
  },
  synonyms: ["Goodbye Dragon Life"],
  genres: [],
  tags: [],
  coverImage: "https://img.example/176053.jpg",
  startYear: 2024,
  relations: [
    {
      id: 999999,
      type: "ANIME" as const,
      relationType: "SEQUEL",
      title: { romaji: "Related Anime" },
    },
  ],
};
const manga = {
  ...anime,
  id: 87415,
  type: "MANGA" as const,
  title: {
    english: "Goodbye Dragon Life, Hello Human Life",
    romaji: "Sayonara Ryuusei, Konnichiwa Jinsei",
    userPreferred: "Goodbye Dragon Life, Hello Human Life",
  },
};

describe("AniList enrichment resolution", () => {
  it("uses one bounded anchor when the provider needs candidate discovery", () => {
    expect(anilistAnchorVariants(["Sasaki to P-chan 7"])).toContain("sasaki");
    expect(anilistAnchorVariants(["Sasaki to P-chan 7"])).not.toContain("p");
    expect(anilistAnchorVariants(["Goodbye Dragon Life Hello Human Life"]))
      .toContain("goodbye dragon life");
  });
  it("adds generic singular token variants without title-specific rules", () => {
    expect(
      anilistProviderVariants([
        "The Strongest Tanks Labyrinth Raids A Tank with a Rare Resistance Skill",
      ]),
    ).toContain("The Strongest Tank Labyrinth Raids");
    expect(
      anilistProviderVariants(["Sousou no Frieren (VF) - Sousou no Frieren - 28 VF"]),
    ).toContain("Sousou no Frieren");
  });

  it("keeps source aliases separate from provider observations", () => {
    const variants = anilistProviderVariants(["Isekai Ojisan"]);
    expect(variants).toContain("Isekai Ojisan");
    expect(variants).not.toContain("Isekai Oji-san");
  });

  it("trusts the exact provider id of a deterministic global catalogue media",async()=>{
    const synthetic={...anime,id:700,title:{english:'Synthetic English Title',romaji:'Synthetic Romaji',native:'合成タイトル',userPreferred:'Synthetic Romaji'},synonyms:[]};
    fetchAniList.mockResolvedValue(synthetic);searchAniList.mockClear();
    const calls:Array<{sql:string;values?:unknown[]}>=[];
    const helpers={logger:{warn:vi.fn()},query:vi.fn(async(sql:string,values?:unknown[])=>{calls.push({sql,values});if(sql.includes('SELECT m.type,COALESCE'))return {rows:[{type:'ANIME',titles:['合成タイトル'],source_titles:[],personal_titles:[],source_urls:[],year:2026,anilist_id:'700',anilist_identity_user_selected:false}]};return {rows:[],rowCount:1}})};
    const result=await enrichAniList({mediaId:'anilist:700',forceRefresh:true},helpers);
    expect(result).toMatchObject({status:'SUCCESS',externalId:700});
    expect(searchAniList).not.toHaveBeenCalled();
    expect(calls.some(call=>call.sql.includes('INSERT INTO media_title')&&call.values?.includes('Synthetic English Title'))).toBe(true);
    expect(calls.some(call=>call.sql.startsWith('UPDATE media_title SET language=')&&call.values?.[1]==='Synthetic English Title'&&call.values?.[2]==='en')).toBe(true);
    const titleUpdates=calls.filter(call=>call.sql.startsWith('UPDATE media_title SET language='));
    expect(titleUpdates.every(call=>call.sql.includes("provenance->>'externalId'=$7")&&call.sql.includes("provenance->>'field'=$8"))).toBe(true);
    expect(titleUpdates.find(call=>call.values?.[1]==='Synthetic Romaji'&&call.values?.[7]==='romaji')?.values?.[6]).toBe('700');
  });

  it("keeps synthetic AniList genres and tag categories as separate assertions",async()=>{
    const synthetic={...anime,id:701,genres:['Adventure'],tags:[{id:1,name:'Found Family',category:'Cast-Main Cast',rank:80,isMediaSpoiler:false,isGeneralSpoiler:false,isAdult:false},{id:2,name:'Synthetic Adult Tag',category:'Content',rank:70,isMediaSpoiler:false,isGeneralSpoiler:false,isAdult:true}]};
    fetchAniList.mockResolvedValue(synthetic);
    const calls:Array<{sql:string;values?:unknown[]}>=[];
    const helpers={logger:{warn:vi.fn()},query:vi.fn(async(sql:string,values?:unknown[])=>{calls.push({sql,values});if(sql.includes('SELECT m.type,COALESCE'))return {rows:[{type:'ANIME',titles:['Synthetic'],source_titles:[],personal_titles:[],source_urls:[],year:null,anilist_id:'701',anilist_identity_user_selected:false}]};return {rows:[],rowCount:1}})};
    await enrichAniList({mediaId:'anilist:701',forceRefresh:true},helpers);
    const assertions=calls.filter(call=>call.sql.includes('INSERT INTO metadata_assertion'));
    expect(assertions.find(call=>call.values?.[1]==='genres')?.values?.[2]).toBe(JSON.stringify(['Adventure']));
    expect(assertions.find(call=>call.values?.[1]==='categories')?.values?.[2]).toBe(JSON.stringify(['Found Family','Synthetic Adult Tag']));
    expect(assertions.some(call=>call.values?.[1]==='adultCategories')).toBe(false);
  });

  it("skips a manga first result and resolves the anime through a returned romaji title", async () => {
    searchAniList.mockImplementation(async (query: string) =>
      /sayonara/i.test(query) ? [anime] : [manga],
    );
    fetchAniList.mockResolvedValue(anime);
    const calls: { sql: string; values?: unknown[] }[] = [];
    const helpers = {
      logger: { warn: vi.fn() },
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        if (sql.includes("SELECT m.type,COALESCE"))
          return {
            rows: [
              {
                type: "ANIME",
                titles: ["Goodbye Dragon Life Hello Human Life", "Sayonara Ryuusei, Konnichiwa Jinsei"],
                year: null,
                anilist_id: null,
              },
            ],
          };
        return { rows: [] };
      }),
    };

    const result = await enrichAniList({ mediaId: "source:dragon-life" }, helpers);

    expect(result).toMatchObject({ status: "SUCCESS", externalId: 176053 });
    expect(searchAniList.mock.calls.map(([query]) => query)).toContain(
      "Sayonara Ryuusei, Konnichiwa Jinsei",
    );
    expect(searchAniList.mock.calls.map(([query]) => query)).not.toContain(
      "Good Bye Dragon Life Hello Human Life",
    );
    expect(searchAniList.mock.calls.every(([, options]) => options.type === "ANIME")).toBe(true);
    expect(helpers.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('externalId=87415 type=MANGA'),
    );
    expect(saveCover).toHaveBeenCalledWith(
      expect.anything(),
      "anilist:176053",
      anime.coverImage,
      "anilist",
      "AniList",
      expect.objectContaining({ externalId: "176053" }),
    );
    expect(calls.some(({ sql }) => sql.includes("INSERT INTO media(id,type)"))).toBe(false);
    expect(calls.some(({ sql }) => sql.includes("kind='relation'"))).toBe(false);
    const relationsAssertion = calls.find(
      ({ sql, values }) => sql.includes("INSERT INTO metadata_assertion") && values?.[1] === "relations",
    );
    expect(relationsAssertion?.values?.[2]).toEqual(JSON.stringify(anime.relations));
    expect(calls.some(({ sql }) => sql.includes("source-url"))).toBe(false);
  });

  it("uses a provider title as a bounded discovery hint without making it a source alias", async () => {
    searchAniList.mockImplementation(async (query: string) =>
      /sayonara/i.test(query) ? [anime] : [manga],
    );
    fetchAniList.mockResolvedValue(anime);
    const calls: { sql: string; values?: unknown[] }[] = [];
    const helpers = {
      logger: { warn: vi.fn() },
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        calls.push({ sql, values });
        if (sql.includes("SELECT m.type,COALESCE"))
          return { rows: [{ type: "ANIME", titles: ["Goodbye Dragon Life Hello Human Life"], source_titles: ["Goodbye Dragon Life Hello Human Life"], year: null, anilist_id: null }] };
        return { rows: [] };
      }),
    };
    const result = await enrichAniList({ mediaId: "source:dragon-discovery" }, helpers);
    expect(result).toMatchObject({ status: "REVIEW", reason: "LOW_CONFIDENCE" });
    expect(searchAniList.mock.calls.map(([query]) => query)).toContain("Sayonara Ryuusei, Konnichiwa Jinsei");
    const sourceQuery = calls.find(({ sql }) => sql.includes("SELECT m.type,COALESCE"));
    expect(sourceQuery?.values?.[0]).toBe("source:dragon-discovery");
  });

  it("uses the parser source identity instead of a copied personal title", async () => {
    const clean = { ...anime, id: 1, title: { userPreferred: "Dororo", english: "Dororo" }, synonyms: [] };
    searchAniList.mockResolvedValue([clean]);
    fetchAniList.mockResolvedValue(clean);
    const helpers = { logger:{warn:vi.fn()}, query:vi.fn(async(sql:string)=>sql.includes("SELECT m.type,COALESCE")?{rows:[{type:"ANIME",titles:["Dororo","Synthetic Copied Browser Caption 08 VOSTFR"],source_titles:["Dororo"],year:null,anilist_id:null}]}:{rows:[]}) };
    const result=await enrichAniList({mediaId:"source:clean-parser-title"},helpers);
    expect(result).toMatchObject({status:"SUCCESS",externalId:1});
    expect(searchAniList.mock.calls.map(([query])=>query)).not.toContain("Synthetic Copied Browser Caption 08 VOSTFR");
  });

  it("stops discovery after one unique explicit-season result batch",async()=>{
    searchAniList.mockClear();
    const root={...anime,id:3,title:{english:'Synthetic: Northern Relay',romaji:'Synthetic: Northern Relay',userPreferred:'Synthetic: Northern Relay'},synonyms:[]};
    const sequel={...anime,id:4,title:{english:'Synthetic: Northern Relay Season 4',romaji:'Synthetic: Northern Relay 4th Season',userPreferred:'Synthetic: Northern Relay 4th Season'},synonyms:[]};
    searchAniList.mockResolvedValue([root,sequel]);
    fetchAniList.mockResolvedValue(sequel);
    const helpers={logger:{warn:vi.fn()},query:vi.fn(async(sql:string)=>sql.includes('SELECT m.type,COALESCE')?{rows:[{type:'ANIME',titles:['Synthetic: Northern Relay S4'],source_titles:['Synthetic: Northern Relay S4'],source_urls:[],year:null,anilist_id:null}]}:{rows:[],rowCount:0})};
    const result=await enrichAniList({mediaId:'source:synthetic-season'},helpers);
    expect(result).toEqual({status:'SUCCESS',externalId:4,mediaId:'anilist:4'});
    expect(searchAniList).toHaveBeenCalledTimes(2);
  });
});
