import { describe, expect, it, vi } from "vitest";
import { readFileSync } from 'node:fs';
import {
  extractPageMetadata,
  fetchAniList,
  fetchAniListCalendar,
  fetchMangaUpdatesReleases,
  matchAniList,
  matchMangaUpdates,
  resolveMangaUpdatesSeries,
  exactMangaUpdatesSeriesMatches,
  exactAniListMediaMatches,
  automaticAniListMediaMatches,
  exactTitleMatchKind,
  isDeadMangaUpdatesSeries,
  mangaUpdatesMediaType,
  mangaUpdatesTypeAllowed,
  searchAniList,
  sourceDispositionFromUrl,
  sourceIdentityFromUrl,
  collectiveTitleKey,
  providerIdFromUrl,
  assertProviderMediaType,
  requiredProviderForMediaType,
  compactTitleKey,
  prepareTitleCandidates,
  titleCandidateFromBookmark,
  explicitTitleAliases,
  titleVariants,
  cleanDisplayTitle,
  canonicalLibraryStatus,
  preSerializationCandidateAllowed,
  aniListFormatAllowed,
  preferredMangaUpdatesSeriesMatch,
  preferredAniListMediaMatch,
  aniListExplicitSeasonMatch,
} from "./index.js";

describe("collective review identity", () => {
  it("accepts opaque MangaUpdates series URLs with or without a slug", () => {
    expect(providerIdFromUrl("mangaupdates", "https://www.mangaupdates.com/series/oqvzgof/synthetic-title")).toBe("oqvzgof");
    expect(providerIdFromUrl("mangaupdates", "https://mangaupdates.com/series/oqvzgof")).toBe("oqvzgof");
  });
  it("rejects wrong domains and paths and keeps AniList numeric", () => {
    expect(providerIdFromUrl("mangaupdates", "https://example.test/series/oqvzgof")).toBeNull();
    expect(providerIdFromUrl("mangaupdates", "https://mangaupdates.com/releases/oqvzgof")).toBeNull();
    expect(providerIdFromUrl("anilist", "https://anilist.co/anime/opaque/title")).toBeNull();
    expect(providerIdFromUrl("anilist", "https://anilist.co/anime/123/title")).toBe("123");
  });
  it("only keys anime seasons when evidence is explicit", () => {
    expect(collectiveTitleKey({provider:"anilist",mediaType:"ANIME",parsedTitle:"Synthetic 2"})).toBe("v1:anilist:ANIME:synthetic 2");
    expect(collectiveTitleKey({provider:"anilist",mediaType:"ANIME",parsedTitle:"Synthetic",explicitSeason:2})).toBe("v1:anilist:ANIME:synthetic:season-2");
    expect(collectiveTitleKey({provider:"mangaupdates",mediaType:"MANGA",parsedTitle:"Synthetic",explicitSeason:2})).toBe("v1:mangaupdates:MANGA:synthetic");
  });
  it("requires the canonical provider explicitly for every media type",()=>{
    expect(requiredProviderForMediaType("ANIME")).toBe("anilist");
    expect(requiredProviderForMediaType("MANGA")).toBe("mangaupdates");
    expect(requiredProviderForMediaType("MANHWA")).toBe("mangaupdates");
    expect(requiredProviderForMediaType("MANHUA")).toBe("mangaupdates");
    expect(()=>assertProviderMediaType({provider:"mangaupdates",mediaType:"ANIME"})).toThrow("PROVIDER_MEDIA_TYPE_MISMATCH");
    expect(()=>assertProviderMediaType({provider:"anilist",mediaType:"MANGA"})).toThrow("PROVIDER_MEDIA_TYPE_MISMATCH");
  });
});

describe('editorial and library projections', () => {
  it('requires explicit pre-serialization evidence without changing ordinary parentheses', () => {
    expect(preSerializationCandidateAllowed(['Example'], ['Example (Pre-serialization)'])).toBe(false);
    expect(preSerializationCandidateAllowed(['Example (Pre-serialisation)'], ['Example (Pre-serialized)'])).toBe(true);
    expect(preSerializationCandidateAllowed(['Example'], ['Example (Author)'])).toBe(true);
  });
  it('enforces OVA symmetrically', () => {
    expect(aniListFormatAllowed(['Example OVA'], 'OVA')).toBe(true);
    expect(aniListFormatAllowed(['Example OVA'], 'TV')).toBe(false);
    expect(aniListFormatAllowed(['Example'], 'OVA')).toBe(false);
    expect(aniListFormatAllowed(['Example'], 'TV')).toBe(true);
  });
  it.each([
    ['50 Chapters (Complete)', 'Completed'], ['12 Volumes\nOn Hiatus', 'Hiatus'],
    ['Ongoing', 'Ongoing'], ['FINISHED', 'Completed'], ['RELEASING', 'Ongoing'], ['Unknown', 'Ongoing'],
  ])('canonicalizes %s', (raw, expected) => expect(canonicalLibraryStatus(raw)).toBe(expected));
});

describe("deterministic display-title cleaning", () => {
  it.each([
    ["I Was Reincarnated as the 7th Prince So I Can Take My Time Perfecting My Magical Ability - I Was Reincarnated as the 7th Prince So I Can Take My Time Perfecting My Magical Ability - 02 VOSTFR - 02 - Voiranime", "I Was Reincarnated as the 7th Prince So I Can Take My Time Perfecting My Magical Ability"],
    ["Solo Leveling - Episode 12 - Chapter 12 - Mangakakalot", "Solo Leveling"],
    ["One Piece - 42 VF - 42 - Anime-Sama", "One Piece"],
    ["The Title - The Title", "The Title"],
  ])("cleans %s", (input, expected) => {
    expect(cleanDisplayTitle(input)).toBe(expected);
  });
  it("keeps title words that only resemble markers", () => {
    expect(cleanDisplayTitle("Sub Zero")) .toBe("Sub Zero");
  });
});

describe("AniList catalogue", () => {
  it('collects the global airing calendar with provider media identifiers',async()=>{
    const fetch=vi.fn(async()=>new Response(JSON.stringify({data:{Page:{pageInfo:{hasNextPage:false},airingSchedules:[{airingAt:1_800_000_000,episode:4,mediaId:700,media:{id:700,type:'ANIME',status:'RELEASING',title:{romaji:'Synthetic Airing'},synonyms:[]}}]}}}),{status:200,headers:{'content-type':'application/json'}}));
    await expect(fetchAniListCalendar(1_799_000_000,1_801_000_000,{fetch,maxPages:1})).resolves.toMatchObject([{id:700,airingSchedule:[{airingAt:1_800_000_000,episode:4}]}]);
    const request=(fetch.mock.calls as unknown as Array<[unknown,{body?:unknown}]>)[0]?.[1];
    expect(JSON.parse(String(request?.body)).query).toContain('airingSchedules(airingAt_greater:$from,airingAt_lesser:$to,sort:TIME)');
  });
  it('requests the future airing page explicitly for the rolling calendar',()=>{
    const source=readFileSync(new URL('./index.ts',import.meta.url),'utf8');
    expect(source).toContain('airingSchedule(notYetAired:true,perPage:50)');
  });
  it("applies reordered-word fallback symmetrically to AniList without popularity", () => {
    const make = (id:number,title:string,popularity:number) => ({id,type:'ANIME',title:{english:title},synonyms:[],popularity}) as any;
    expect(preferredAniListMediaMatch(['Crimson Small Hero'],[make(1,'Small Crimson Hero',1),make(2,'Small Hero',999999)])?.id).toBe(1);
    expect(preferredAniListMediaMatch(['Synthetic Show'],[make(1,'Synthetic Show',1000),make(2,'Synthetic Show',1)])).toBeUndefined();
  });
  it("selects only a uniquely newest exact AniList identity", () => {
    const make=(id:number,startDate:any,popularity:number,startYear?:number)=>({id,type:'ANIME',title:{english:'Synthetic Exact'},synonyms:[],startDate,startYear,popularity}) as any;
    expect(preferredAniListMediaMatch(['Synthetic Exact'],[make(1,{year:2020,month:2,day:3},999999),make(2,{year:2024,month:1,day:2},1)])?.id).toBe(2);
    expect(preferredAniListMediaMatch(['Synthetic Exact'],[make(1,{year:2024},1),make(2,{year:2024},999999)])).toBeUndefined();
    expect(preferredAniListMediaMatch(['Synthetic Exact'],[make(1,{year:2024,month:13,day:1},1),make(2,{year:2023,month:1,day:1},2)])).toBeUndefined();
    expect(preferredAniListMediaMatch(['Synthetic Exact'],[make(1,{year:2024},1,2023),make(2,{year:2023},2)])).toBeUndefined();
  });
  it("uses the same exact-date tiebreak for MangaUpdates", () => {
    const make=(id:string,startDate?:string,year?:number,ratingVotes=0)=>({id,title:'Synthetic Exact',titles:['Synthetic Exact'],type:'Manhwa',status:'Ongoing',image:`https://example.test/${id}.jpg`,startDate,year,ratingVotes}) as any;
    expect(preferredMangaUpdatesSeriesMatch(['Synthetic Exact'],[make('1','2020-02-03',2020,999999),make('2','2024-01-02',2024,1)])?.id).toBe('2');
    expect(preferredMangaUpdatesSeriesMatch(['Synthetic Exact'],[make('1',undefined,2024,1),make('2',undefined,2024,999999)])).toBeUndefined();
    expect(preferredMangaUpdatesSeriesMatch(['Synthetic Exact'],[make('1','invalid',2024),make('2','2023-01-01',2023)])).toBeUndefined();
    expect(preferredMangaUpdatesSeriesMatch(['Synthetic Exact'],[make('1','2024-01-01',2023),make('2','2023-01-01',2023)])).toBeUndefined();
  });
  it("keeps exact ahead of reordered words and a simple exact ahead of a parenthesized variant", () => {
    const anime=(id:number,title:string,year:number)=>({id,type:'ANIME',title:{english:title},synonyms:[],startDate:{year}}) as any;
    expect(preferredAniListMediaMatch(['Synthetic Exact'],[anime(1,'Synthetic Exact',2020),anime(2,'Exact Synthetic',2026)])?.id).toBe(1);
    expect(preferredAniListMediaMatch(['Synthetic Exact'],[anime(1,'Synthetic Exact',2020),anime(2,'Synthetic Exact (Edition)',2026)])?.id).toBe(1);
  });
  it("recognizes a unique MangaUpdates title with the same significant words reordered", () => {
    const base={type:'Manhwa',year:2024,status:'Ongoing',image:'https://example.test/a.jpg'};
    const selected=preferredMangaUpdatesSeriesMatch(['My Crimson Small Hero'],[
      {id:'1',title:'My Small Crimson Hero',titles:['My Small Crimson Hero'],...base},
      {id:'2',title:'My Small Hero',titles:['My Small Hero'],...base},
    ] as any);
    expect(selected?.id).toBe('1');
  });
  it("matches exact titles in all fields and treats a final parenthesized suffix as a variant", () => {
    expect(exactTitleMatchKind("Existence", "Existence")).toBe("NORMALIZED_EXACT");
    expect(exactTitleMatchKind("Existence", "Existence (Wangho)")).toBe("PARENTHESIZED_EXACT");
    expect(exactTitleMatchKind("Existence", "Existence (Wangho) Extra")).toBeUndefined();
    expect(exactTitleMatchKind("Synthetic Cleric", "Synthetic Cleric: Office Worker Survival Path")).toBe("SUBTITLE_EXACT");
    expect(exactTitleMatchKind("Office Worker Survival Path", "Synthetic Cleric: Office Worker Survival Path")).toBe("SUBTITLE_EXACT");
    expect(exactTitleMatchKind("Synthetic Champion (The Champion)", "Synthetic Champion")).toBe("ALIAS_PARENTHESIZED_EXACT");
    const items = [
      { id: 1, type: "ANIME", title: { userPreferred: "Other" }, synonyms: ["Existence"] },
      { id: 2, type: "ANIME", title: { userPreferred: "Existence (Wangho)" }, synonyms: [] },
    ] as any;
    expect(exactAniListMediaMatches(["Existence"], items).map(item => item.id)).toEqual([1, 2]);
  });
  it("selects a unique provider base when the source adds a parenthesized alternate title", () => {
    const anime={id:1,type:'ANIME',title:{romaji:'Synthetic Champion'},synonyms:[],startDate:{year:2020}} as any;
    expect(preferredAniListMediaMatch(['Synthetic Champion (The Champion)'],[anime])?.id).toBe(1);
    const reading={id:'1',title:'Synthetic Champion',titles:[],type:'Manhwa',year:2020,status:'Ongoing',image:'https://example.test/champion.jpg'} as any;
    expect(preferredMangaUpdatesSeriesMatch(['Synthetic Champion (The Champion)'],[reading])?.id).toBe('1');
  });
  it("uses a final parenthesized alternate title as a bounded identity alias", () => {
    expect(explicitTitleAliases(['Synthetic Primary (Synthetic Alternate)'])).toEqual([
      'Synthetic Primary (Synthetic Alternate)',
      'Synthetic Primary',
      'Synthetic Alternate',
    ]);
    expect(explicitTitleAliases(['Synthetic (Nested (Unsafe))'])).toEqual(['Synthetic (Nested (Unsafe))']);
    const reading={id:'synthetic',title:'Synthetic Alternate',titles:[],type:'Manhwa',year:2024,status:'Ongoing',image:'https://example.test/synthetic.jpg'} as any;
    expect(preferredMangaUpdatesSeriesMatch(explicitTitleAliases(['Synthetic Primary (Synthetic Alternate)']),[reading])?.id).toBe('synthetic');
    const anime={id:99,type:'ANIME',title:{english:'Synthetic Alternate'},synonyms:[],startDate:{year:2024}} as any;
    expect(preferredAniListMediaMatch(explicitTitleAliases(['Synthetic Primary (Synthetic Alternate)']),[anime])?.id).toBe(99);
  });
  it("combines an exact provider base with independent explicit season evidence", () => {
    const sequel={id:2,type:'ANIME',title:{romaji:'Synthetic Evolution: Continued Path',english:'Synthetic Evolution Season 2'},synonyms:[],startDate:{year:2024}} as any;
    expect(aniListExplicitSeasonMatch('Synthetic Evolution 2',sequel)).toBe(true);
    expect(preferredAniListMediaMatch(['Synthetic Evolution 2'],[sequel])?.id).toBe(2);
    expect(aniListExplicitSeasonMatch('Synthetic Evolution 3',sequel)).toBe(false);
    expect(aniListExplicitSeasonMatch('Synthetic Evolution 2',{...sequel,title:{romaji:'Synthetic Evolution: Continued Path'}})).toBe(false);
  });
  it("selects a unique provider title whose explicit subtitle extends the source identity symmetrically", () => {
    const anime={id:1,type:'ANIME',title:{romaji:'Synthetic Cleric: Office Worker Survival Path'},synonyms:[],startDate:{year:2023}} as any;
    expect(preferredAniListMediaMatch(['Synthetic Cleric'],[anime])?.id).toBe(1);
    const reading={id:'1',title:'Synthetic Cleric: Office Worker Survival Path',titles:[],type:'Manhwa',year:2023,status:'Ongoing',image:'https://example.test/cover.jpg'} as any;
    expect(preferredMangaUpdatesSeriesMatch(['Synthetic Cleric'],[reading])?.id).toBe('1');
    const translated={...anime,id:2,title:{english:'Synthetic 100: Final Errand List'}};
    expect(preferredAniListMediaMatch(['Final Errand List'],[translated])?.id).toBe(2);
  });
  it("prepares bookmark and URL titles using URL release evidence", () => {
    const anime = sourceIdentityFromUrl("https://v5.voiranime.com/anime/remonster/re-monster-02-vostfr/");
    expect(anime).toMatchObject({ title: "Re Monster", type: "ANIME", slug: "remonster" });
    const prepared = prepareTitleCandidates({
      bookmarkTitle: "Re:Monster - Re Monster - 02 VOSTFR - 02 - Voiranime",
      url: "https://v5.voiranime.com/anime/remonster/re-monster-02-vostfr/",
      source: anime,
    });
    expect(prepared.candidates).toContain("Re:Monster");
    expect(prepared.candidates[0]).toBe("Re:Monster");
    expect(compactTitleKey("Re:Monster")).toBe(compactTitleKey("Re Monster"));
    expect(compactTitleKey("Re Monster")).toBe(compactTitleKey("Remonster"));
  });

  it("uses path type over an anime-looking hostname and removes scan markers", () => {
    expect(sourceIdentityFromUrl("https://anime-sama.fr/catalogue/child-of-the-sheath/scan/vf/")).toMatchObject({
      title: "Child Of The Sheath", type: "MANGA",
    });
    expect(sourceIdentityFromUrl("https://anime-sama.fr/catalogue/maybe-meant-to-be/scan/vf/")).toMatchObject({
      title: "Maybe Meant To Be", type: "MANGA",
    });
  });

  it("keeps title words that merely resemble release markers", () => {
    expect(prepareTitleCandidates({
      bookmarkTitle: "Sub Zero",
      url: "https://reader.example/series/sub-zero",
    }).personal).toBe("Sub Zero");
    expect(prepareTitleCandidates({
      bookmarkTitle: "Sasaki to P-chan 7",
      url: "https://reader.example/series/sasaki-to-p-chan-7",
    }).personal).toBe("Sasaki to P-chan 7");
  });

  it("removes universal catalogue marketing tails and extracts only an explicit trailing year", () => {
    expect(titleCandidateFromBookmark("Synthetic Chronicle Manga English [New Chapters]"))
      .toBe("Synthetic Chronicle");
    expect(titleCandidateFromBookmark("Synthetic Chronicle Manga English [New Chapters] Online Free"))
      .toBe("Synthetic Chronicle");
    expect(cleanDisplayTitle("Synthetic Chronicle Manga English [New Chapters] Online Free"))
      .toBe("Synthetic Chronicle");
    expect(prepareTitleCandidates({
      bookmarkTitle: "Read Synthetic Chronicle Manga English [New Chapters] Online Free - Synthetic Reader",
      url: "https://synthetic-reader.example/manga/synthetic-chronicle/chapter-54",
    }).personal).toBe("Synthetic Chronicle");
    expect(prepareTitleCandidates({
      bookmarkTitle: "Synthetic Chronicle Manga English [New Chapters] (2023)",
      url: "https://reader.example/series/synthetic-chronicle",
    })).toMatchObject({ personal: "Synthetic Chronicle", year: 2023 });
    expect(prepareTitleCandidates({
      bookmarkTitle: "Synthetic Chronicle Manga English [New Chapters] 2023",
      url: "https://reader.example/series/synthetic-chronicle",
    })).toMatchObject({ personal: "Synthetic Chronicle", year: 2023 });
    expect(prepareTitleCandidates({
      bookmarkTitle: "Synthetic Chronicle Manga English [New Chapters]",
      url: "https://reader.example/series/synthetic-chronicle",
    }).year).toBeUndefined();
  });

  it("uses path evidence for release suffixes without deleting title words", () => {
    expect(sourceIdentityFromUrl("https://v5.voiranime.com/anime/remonster/re-monster-02-vostfr/")).toMatchObject({
      releaseSuffix: "02-vostfr",
    });
    expect(sourceIdentityFromUrl("https://reader.example/im-a-sub/dub-01")).toMatchObject({
      title: "Im A Sub",
      releaseSuffix: "dub-01",
    });
    expect(prepareTitleCandidates({
      bookmarkTitle: "Watch My Series",
      url: "https://reader.example/saison1/vostfr/",
    }).personal).toBe("My Series");
  });

  it("resolves source releases without using the personal bookmark title", () => {
    expect(
      sourceIdentityFromUrl(
        "https://reader.example/series/solo-leveling/chapter/42",
      ),
    ).toMatchObject({
      title: "Solo Leveling",
      type: "MANGA",
      canonicalUrl: "https://reader.example/series/solo-leveling",
    });
    expect(sourceIdentityFromUrl('https://comick.dev/comic/00-new-employee-kim-chul-soo/chapter-85-en')).toMatchObject({
      title: 'New Employee Kim Chul Soo', slug: 'new-employee-kim-chul-soo',
    });
    expect(titleCandidateFromBookmark('Chapter 85 (English) - New Employee Kim Chul-Soo | ComicK')).toBe('New Employee Kim Chul-Soo');
    expect(
      sourceIdentityFromUrl(
        "https://comix.to/title/2l25-moral-less-scandal/10088140-chapter-44",
      ),
    ).toMatchObject({
      title: "Moral Less Scandal",
      canonicalUrl: "https://comix.to/title/2l25-moral-less-scandal",
    });
    expect(
      sourceIdentityFromUrl(
        "https://classroomoftheelite.com/manga/classroom-of-the-elite-chapter-74/",
      ),
    ).toMatchObject({ title: "Classroom Of The Elite" });
    expect(
      sourceIdentityFromUrl(
        "https://mangareader.to/read/dame-skill-jidou-kinou-ga-kakusei-shimashita-56218/en/chapter-15",
      ),
    ).toMatchObject({ title: "Dame Skill Jidou Kinou Ga Kakusei Shimashita" });
    expect(
      sourceIdentityFromUrl(
        "https://comick.io/comic/beneath-the-lady-s-mask/8sOey0Vd-chapter-51-en",
      ),
    ).toMatchObject({
      title: "Beneath The Lady S Mask",
      type: "MANGA",
      canonicalUrl: "https://comick.io/comic/beneath-the-lady-s-mask",
    });
    expect(
      sourceIdentityFromUrl(
        "https://comick.to/comic/beneath-the-lady-s-mask/8sOey0Vd-chapter-51-en",
      ),
    ).toMatchObject({
      title: "Beneath The Lady S Mask",
      type: "MANGA",
      canonicalUrl: "https://comick.to/comic/beneath-the-lady-s-mask",
    });
    expect(
      titleCandidateFromBookmark("Wrong personal label — Chapter 42"),
    ).toBe("Wrong personal label");
    expect(
      titleCandidateFromBookmark(
        "I Became the Villainess’s Favorite Chapter 31 – English | ResetScans",
      ),
    ).toBe("I Became the Villainess’s Favorite");
    expect(titleCandidateFromBookmark("Moral-less Scandal · Ch.44")).toBe(
      "Moral-less Scandal",
    );
  });
  it("extracts only public page metadata", () =>
    expect(
      extractPageMetadata(
        '<title>Frieren</title><meta property="og:image" content="/cover.jpg">',
        "https://reader.example/episode/2",
      ),
    ).toMatchObject({
      title: "Frieren",
      image: "https://reader.example/cover.jpg",
    }));
  it("searches AniList through one bounded GraphQL request and matches uniquely", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            p0: {
              media: [
                {
                  id: 1,
                  type: "ANIME",
                  title: { romaji: "Frieren", userPreferred: "Frieren" },
                  synonyms: ["Sousou no Frieren"],
                  genres: [],
                  coverImage: { large: "https://img.example/f.jpg" },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const items = await searchAniList("Frieren", {
      endpoint: "https://anilist.test",
      fetch: fetcher,
      now: 1,
    });
    expect(
      matchAniList({ aliases: ["Sousou no Frieren"], type: "ANIME" }, items)
        ?.media.id,
    ).toBe(1);
    const body = String(fetcher.mock.calls[0][1]?.body);
    expect(body).not.toContain("tags");
    expect(body).not.toContain("streamingEpisodes");
    expect(body).not.toContain("bannerImage color siteUrl");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("does not accept an unrelated first AniList result", () => {
    const item = (id: number, title: string) => ({ id, type: "ANIME", title: { userPreferred: title }, synonyms: [], genres: [], tags: [], relations: [], airingSchedule: [], streamingEpisodes: [], studios: [] });
    expect(matchAniList({ aliases: ["Re:Monster"], type: "ANIME" }, [item(1, "Digimon Universe: Appli Monsters") as any, item(2, "Monster") as any, item(3, "Remonster") as any])?.media.id).toBe(3);
  });
  it("matches punctuation variants through the compact source key", () => {
    const item = { id: 99, type: "ANIME", title: { userPreferred: "Isekai Oji-san" }, synonyms: [], genres: [], tags: [], relations: [], airingSchedule: [], streamingEpisodes: [], studios: [] };
    expect(matchAniList({ aliases: ["Isekai Ojisan"], type: "ANIME" }, [item as any])?.media.id).toBe(99);
  });
  it("auto-selects the parser-clean Dororo identity but keeps duplicate exact titles ambiguous", () => {
    const item = (id: number, title: string) => ({ id, type: "ANIME", title: { userPreferred: title }, synonyms: [], genres: [], tags: [], relations: [], airingSchedule: [], streamingEpisodes: [], studios: [] });
    expect(automaticAniListMediaMatches(["Dororo"], [item(1,"Dororo") as any]).map(x=>x.id)).toEqual([1]);
    expect(automaticAniListMediaMatches(["Dororo"], [item(1,"Dororo") as any,item(3,"Dororo") as any])).toHaveLength(2);
  });
  it("accepts one clear canonical prefix but rejects competing partial titles", () => {
    const item = (id: number, english: string) => ({ id, type: "ANIME", title: { english, userPreferred: english }, synonyms: [], genres: [], tags: [], relations: [], airingSchedule: [], streamingEpisodes: [], studios: [] });
    const expected = item(176053, "Good Bye, Dragon Life");
    expect(matchAniList({ aliases: ["Goodbye Dragon Life, Hello Human Life"], type: "ANIME" }, [expected as any])?.media.id).toBe(176053);
    expect(matchAniList({ aliases: ["Goodbye Dragon Life, Hello Human Life"], type: "ANIME" }, [expected as any, item(2, "Hello Human Life") as any])).toBeNull();
  });
  it("coalesces simultaneous title searches into one HTTP request", async () => {
    const media = (id: number, title: string) => ({
      id,
      type: "MANGA",
      title: { romaji: title, userPreferred: title },
      synonyms: [],
      genres: [],
      coverImage: { large: `https://img.example/${id}.jpg` },
    });
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            p0: { media: [media(2, "Alpha")] },
            p1: { media: [media(3, "Beta")] },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const [alpha, beta] = await Promise.all([
      searchAniList("Alpha", {
        endpoint: "https://anilist.batch.test",
        fetch: fetcher,
        now: 100,
      }),
      searchAniList("Beta", {
        endpoint: "https://anilist.batch.test",
        fetch: fetcher,
        now: 100,
      }),
    ]);
    expect(alpha[0]?.id).toBe(2);
    expect(beta[0]?.id).toBe(3);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("can force a fresh observed request for every manual audit lookup", async () => {
    const payload = { data: { p0: { media: [] } } };
    const fetcher = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    await searchAniList("Audit Cache Probe", {
      endpoint: "https://anilist.audit.test",
      fetch: fetcher,
      cache: false,
    });
    await searchAniList("Audit Cache Probe", {
      endpoint: "https://anilist.audit.test",
      fetch: fetcher,
      cache: false,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("coalesces known AniList IDs through Page id_in", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            Page: {
              media: [
                {
                  id: 101,
                  type: "MANGA",
                  title: { romaji: "Known One" },
                  synonyms: [],
                  genres: [],
                  coverImage: { large: "https://img.example/101.jpg" },
                },
                {
                  id: 102,
                  type: "MANGA",
                  title: { romaji: "Known Two" },
                  synonyms: [],
                  genres: [],
                  coverImage: { large: "https://img.example/102.jpg" },
                },
              ],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const [one, two] = await Promise.all([
      fetchAniList(101, {
        endpoint: "https://anilist.ids.test",
        fetch: fetcher,
      }),
      fetchAniList(102, {
        endpoint: "https://anilist.ids.test",
        fetch: fetcher,
      }),
    ]);
    expect(one.id).toBe(101);
    expect(two.id).toBe(102);
    const body = String(fetcher.mock.calls[0][1]?.body);
    expect(body).toContain("id_in");
    expect(body).toContain("tags");
    expect(body).toContain("streamingEpisodes");
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("batches 50 AniList IDs per GraphQL request", async () => {
    const fetcher = vi.fn(async (_input, init) => {
      const ids = JSON.parse(String(init?.body)).variables.ids as number[];
      return new Response(
        JSON.stringify({
          data: {
            Page: {
              media: ids.map((id) => ({
                id,
                type: "MANGA",
                title: { romaji: `Title ${id}` },
                synonyms: [],
                genres: [],
              })),
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const hooks = { beforeRequest: async () => async () => {} };
    await Promise.all(
      Array.from({ length: 50 }, (_, index) =>
        fetchAniList(1000 + index, { fetch: fetcher, hooks, cache: false }),
      ),
    );
    expect(fetcher).toHaveBeenCalledOnce();
    await Promise.all(
      Array.from({ length: 51 }, (_, index) =>
        fetchAniList(2000 + index, { fetch: fetcher, hooks, cache: false }),
      ),
    );
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it("releases the current slot and retries after AniList HTTP 429", async () => {
    const release = vi.fn(async () => {});
    const beforeRequest = vi.fn(async () => release);
    const onRateLimit = vi.fn(async () => {});
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "retry-after": "0.01" } }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: {
              Page: {
                media: [
                  {
                    id: 9090,
                    type: "ANIME",
                    title: { romaji: "Retry" },
                    synonyms: [],
                    genres: [],
                  },
                ],
              },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    const started = Date.now();
    await fetchAniList(9090, {
      fetch: fetcher,
      hooks: { beforeRequest, onRateLimit },
      cache: false,
    });
    expect(Date.now() - started).toBeGreaterThanOrEqual(8);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(beforeRequest).toHaveBeenCalledTimes(2);
    expect(release).toHaveBeenCalledTimes(2);
    expect(onRateLimit).toHaveBeenCalledOnce();
  });
  it("parses the global MangaUpdates release feed and matches multilingual titles", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          releases: [
            {
              series_id: 42,
              series_title: "나 혼자만 레벨업",
              chapter: "201",
              release_date: "2026-08-03",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const releases = await fetchMangaUpdatesReleases({
      endpoint: "https://mu.test/v1",
      fetch: fetcher,
      startDate: "2026-08-03",
      endDate: "2026-08-17",
    });
    expect(releases[0]).toMatchObject({ seriesId: "42", chapter: "201" });
    expect(
      matchMangaUpdates(
        {
          aliases: [
            "Solo Leveling",
            "俺だけレベルアップな件",
            "나 혼자만 레벨업",
          ],
        },
        [{ id: "42", title: "Solo Leveling", titles: ["나 혼자만 레벨업"], image: "https://img.example/solo.jpg" }],
      )?.series.id,
    ).toBe("42");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: "POST",
    });
    expect(String(fetcher.mock.calls[0][0])).toContain('/releases/search');
    expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('authorization');
    expect(JSON.parse(String(fetcher.mock.calls[0][1]?.body))).toMatchObject({start_date:'2026-08-03',end_date:'2026-08-17',include_metadata:true,page:1});
  });
  it("paginates authenticated release search through total_hits without scraping", async () => {
    const response=(page:number)=>new Response(JSON.stringify({total_hits:2,releases:[{series_id:String(page),series_title:`Synthetic ${page}`,chapter:String(page),release_date:`2026-08-0${page}` }]}),{status:200,headers:{'content-type':'application/json'}});
    const fetcher=vi.fn().mockResolvedValueOnce(response(1)).mockResolvedValueOnce(response(2));
    const releases=await fetchMangaUpdatesReleases({endpoint:'https://mu.test/v1',fetch:fetcher,startDate:'2026-08-01',endDate:'2026-08-15',pageSize:1});
    expect(releases.map(value=>value.seriesId)).toEqual(['1','2']);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every(call=>String(call[0]).includes('/releases/search'))).toBe(true);
  });
  it('maps the documented nested release record and metadata series envelope',async()=>{
    const fetcher=vi.fn().mockResolvedValue(new Response(JSON.stringify({total_hits:1,results:[{record:{id:700,title:'Synthetic Reading Release',volume:'4',chapter:'58.5',groups:[{name:'Synthetic Group'}],release_date:'2026-08-06'},metadata:{series:{series_id:900,title:'Synthetic Reading Series',url:'https://www.mangaupdates.com/series/synthetic'}}}]}),{status:200,headers:{'content-type':'application/json'}}));
    const [release]=await fetchMangaUpdatesReleases({endpoint:'https://mu.test/v1',fetch:fetcher,startDate:'2026-08-01',endDate:'2026-08-15'});
    expect(release).toMatchObject({seriesId:'900',seriesTitle:'Synthetic Reading Release',title:'Synthetic Reading Release',volume:'4',chapter:'58.5',group:'Synthetic Group',releaseDate:'2026-08-06',url:'https://www.mangaupdates.com/series/synthetic'});
    expect(release?.raw).toMatchObject({record:{id:700}});
  });
  it("scores every result and rejects dead records and novels", () => {
    const results = [
      { id: "47749967463", title: "Wrong result", type: "Manga" as const },
      { id: "novel", title: "The Beginning", type: "Light Novel", image: "https://img/novel.jpg" },
      { id: "24277219018", title: "The Beginning", type: "Manhwa", image: "https://img/good.jpg", description: "A series", latestChapter: "0" },
    ];
    expect(resolveMangaUpdatesSeries(["The Beginning"], results)?.id).toBe("24277219018");
    expect(resolveMangaUpdatesSeries(["The Beginning"], [...results].reverse())?.id).toBe("24277219018");
    expect(matchMangaUpdates({ aliases: ["The Beginning"] }, results)?.series.id).toBe("24277219018");
  });

  it("rejects an ambiguous exact match when provider date evidence has an unexpected shape", () => {
    const candidates = [
      { id: "synthetic-a", title: "Synthetic Exact", type: "Manga" as const, image: "https://img.test/a.jpg", startDate: { year: 2025 } as unknown as string },
      { id: "synthetic-b", title: "Synthetic Exact", type: "Manga" as const, image: "https://img.test/b.jpg", startDate: "2024-01-01" },
    ];
    expect(preferredMangaUpdatesSeriesMatch(["Synthetic Exact"], candidates)).toBeUndefined();
  });

  it("uses MangaUpdates as the authoritative reading type", () => {
    expect(mangaUpdatesMediaType("Manhwa")).toBe("MANHWA");
    expect(mangaUpdatesMediaType("manga")).toBe("MANGA");
    expect(mangaUpdatesMediaType("Light Novel")).toBeUndefined();
    expect(matchMangaUpdates(
      { aliases: ["New Employee"] },
      [{ id: "new-employee-mu", title: "New Employee", type: "Manhwa", image: "https://img.example/new-employee.jpg" }],
    )?.series.type).toBe("Manhwa");
    expect(matchMangaUpdates(
      { aliases: ["The God of War is Leveling Up"] },
      [{ id: "god-of-war-mu", title: "The God of War is Leveling Up", type: "Manhua", image: "https://img.example/god.jpg" }],
    )?.series.id).toBe("god-of-war-mu");
  });

  it("accepts only OEL records with comic evidence and still rejects every novel", () => {
    const comic = { id: "oel-comic", title: "The Beginning After the End", type: "OEL", status: "227 Chapters (Ongoing)", image: "https://img.example/oel.jpg" };
    expect(mangaUpdatesTypeAllowed(comic)).toBe(true);
    expect(resolveMangaUpdatesSeries(["The Beginning After the End"], [comic])?.id).toBe("oel-comic");
    expect(mangaUpdatesTypeAllowed({ ...comic, id: "oel-unproven", status: undefined, categories: [] })).toBe(false);
    expect(mangaUpdatesTypeAllowed({ ...comic, id: "novel", type: "OEL Web Novel" })).toBe(false);
    expect(mangaUpdatesTypeAllowed({ ...comic, id: "novel-2", type: "Novel", status: "227 Chapters" })).toBe(false);
  });

  it("matches only explicit final season markers across roman and arabic forms", () => {
    const seasonFive = { id: 170732, type: "ANIME", title: { userPreferred: "Dungeon title" }, synonyms: ["DanMachi V", "DanMachi Season 5"] } as any;
    const seasonSix = { id: 207385, type: "ANIME", title: { userPreferred: "DanMachi VI" }, synonyms: [] } as any;
    expect(exactAniListMediaMatches(["Danmachi 5"], [seasonFive, seasonSix]).map(item => item.id)).toEqual([170732]);
    expect(matchAniList({ aliases: ["Danmachi 5"], type: "ANIME" }, [seasonSix, seasonFive])?.media.id).toBe(170732);
    expect(exactTitleMatchKind("Studio 54", "Studio LIV")).toBeUndefined();
  });

  it("normalizes only the return inflection for a strong multi-token MangaUpdates match", () => {
    const candidate = { id: "composer", title: "Genius Lout Composer Returns", titles: ["The Return of a Crazy Genius Composer"], type: "Manhwa", image: "https://img.example/composer.jpg", description: "A webtoon" };
    expect(resolveMangaUpdatesSeries(["The Crazy Genius Composer Returns"], [candidate])?.id).toBe("composer");
    expect(resolveMangaUpdatesSeries(["The Crazy Genius Returns"], [{ ...candidate, id: "unrelated", title: "The Hero Returns", titles: [] }])).toBeNull();
  });

  it("matches grammatical rewrites and ordinal spellings without title-specific aliases", () => {
    const intended = { id: "chaebol", title: "Turns Out to Be a Third-Generation Chaebol", type: "Manhwa", year: 2026, status: "12 Chapters (Ongoing)" };
    const unrelated = { id: "secret", title: "Secret Affairs of the 3rd Generation Chaebol", type: "Manhwa", year: 2026, status: "Ongoing" };
    expect(resolveMangaUpdatesSeries(
      ["Turns Out, It’s the 3rd Generation of the Chaebol"],
      [unrelated, intended],
    )?.id).toBe("chaebol");
  });

  it("rejects a semantic guess and equally plausible fuzzy candidates", () => {
    const base = { type: "Manhwa", year: 2025, status: "Ongoing" };
    expect(resolveMangaUpdatesSeries(
      ["Hua Tuo Reincarnated as a Modern Surgical Genius"],
      [{ ...base, id: "surgeon", title: "Hua Tuo Becomes a Surgeon" }],
    )).toBeNull();
    expect(resolveMangaUpdatesSeries(
      ["Return of the Frozen Player"],
      [
        { ...base, id: "one", title: "The Frozen Player Returns" },
        { ...base, id: "two", title: "Return of a Frozen Player" },
      ],
    )).toBeNull();
  });

  it("uses all aliases, including a later alias, and does not reject chapter zero with identity", () => {
    const zeroChapter = { id: "1", title: "Preferred title", type: "Manga", image: "https://img/cover.jpg", latestChapter: "0" };
    expect(isDeadMangaUpdatesSeries(zeroChapter)).toBe(false);
    expect(resolveMangaUpdatesSeries(["Source label", "Preferred title"], [zeroChapter])?.id).toBe("1");
  });
  it("finds a unique exact title in every returned title field, regardless of rank", () => {
    const items = [
      { id: "1", title: "Genius Lout Composer Returns", type: "Manhwa", image: "https://img/1.jpg" },
      { id: "2", title: "Other", titles: ["The Crazy Genius Composer Returns"], type: "Manhwa", image: "https://img/2.jpg" },
    ];
    expect(exactMangaUpdatesSeriesMatches(["The Crazy Genius Composer Returns"], items).map(item => item.id)).toEqual(["2"]);
  });

  it("returns only the exact and parenthesized group", () => {
    const items = [
      { id: "1", title: "Generic Existence", type: "Manhwa", image: "https://img/1.jpg" },
      { id: "2", title: "Existence", type: "Manhwa", image: "https://img/2.jpg" },
      { id: "3", title: "Existence (Wangho)", type: "Manhwa", image: "https://img/3.jpg" },
    ];
    expect(exactMangaUpdatesSeriesMatches(["Existence"], items).map(item => item.id)).toEqual(["2", "3"]);
  });

  it("rejects genuinely dead MangaUpdates records", () => {
    expect(isDeadMangaUpdatesSeries({ id: "dead", title: "Dead record" })).toBe(true);
    expect(resolveMangaUpdatesSeries(["Dead record"], [{ id: "dead", title: "Dead record" }])).toBeNull();
  });
  it("excludes only the exact catalogue utility path", () => {
    expect(sourceDispositionFromUrl("https://anime-sama.fr/catalogue")).toEqual(
      { status: "excluded", reason: "UTILITY_PAGE" },
    );
    expect(
      sourceDispositionFromUrl("https://anime-sama.fr/catalogue/index.php?page=11"),
    ).toEqual({ status: "excluded", reason: "UTILITY_PAGE" });
    expect(
      sourceIdentityFromUrl("https://anime-sama.fr/catalogue/frieren"),
    ).toMatchObject({ title: "Frieren" });
  });
  it("parses MangaUpdates result records and associated multilingual titles", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            {
              record: {
                id: 77,
                title: "Kami ni Aisareta Ko",
                type: "Manhwa",
                associated: [
                  { title: "신에게 사랑받은 아이" },
                  { title: { ja: "神に愛された子" } },
                ],
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const series = await (
      await import("./index.js")
    ).searchMangaUpdatesSeries("Kami ni Aisareta Ko", {
      endpoint: "https://mu.record.test/v1",
      fetch: fetcher,
    });
    expect(series[0]).toMatchObject({ id: "77", title: "Kami ni Aisareta Ko" });
    expect(series[0]?.titles).toEqual(
      expect.arrayContaining(["신에게 사랑받은 아이", "神に愛された子"]),
    );
    expect(series[0]?.titles).not.toContain("ja");
    expect(matchMangaUpdates(
      { aliases: ["Titre français"], type: "MANHWA" },
      [{ id: "78", title: "Titre anglais", titles: ["Titre français"], type: "Manhwa", image: "https://img.example/mu.jpg" }],
    )?.series.id).toBe("78");
  });
  it("parses the live MangaUpdates search envelope and keeps hit_title separate", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [{
        record: {
          series_id: 66249161611,
          title: "Resurrection Boy",
          type: "Manhwa",
          year: 2024,
          genres: ["Action"],
          bayesian_rating: 8.1,
          rating_votes: 42,
          image: { url: { original: "https://img.example/resurrection.jpg", thumbnail: "https://img.example/resurrection-small.jpg" } },
        },
        hit_title: "Resurrection Boy",
      }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const [series] = await (await import("./index.js")).searchMangaUpdatesSeries("Resurrection Boy", {
      endpoint: "https://mu.live-shape.test/v1", fetch: fetcher,
    });
    expect(series).toMatchObject({
      id: "66249161611", title: "Resurrection Boy", hitTitle: "Resurrection Boy",
      type: "Manhwa", image: "https://img.example/resurrection.jpg", bayesianRating: 8.1,
    });
    expect(series?.imageThumbnail).toBe("https://img.example/resurrection-small.jpg");
    expect(series).not.toHaveProperty("raw");
    expect(matchMangaUpdates({ aliases: ["Resurrection Boy"] }, [series!])?.series.type).toBe("Manhwa");
  });
  it("keeps compact and normalized variants for multi-signal searches", () =>
    expect(titleVariants(["Café — Blue Sky"])).toEqual(
      expect.arrayContaining([
        "Café — Blue Sky",
        "cafe blue sky",
        "cafebluesky",
      ]),
    ));
  it("cleans release and site slop only for display", async () => {
    const { cleanDisplayTitle } = await import("./index.js");
    expect(cleanDisplayTitle("Frieren - Episode 12 VOSTFR - VoirAnime")).toBe("Frieren");
    expect(cleanDisplayTitle("Solo Leveling Chapter 38 | Mangakakalot")).toBe("Solo Leveling");
  });
});
